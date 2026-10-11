#!/usr/bin/env node
/**
 * S-068 (#721): One-off ops script — cleanup sweep for legacy plaintext
 * face frames in R2/B2 under the `frames/` prefix.
 *
 * Problem: Before S-059 (#630), face frames were uploaded as raw JPEGs
 * (`video-frame-<timestamp>-<index>.jpg`, Content-Type: image/jpeg) with no
 * encryption. S-059 encrypts all new uploads (AES-256-GCM envelope, stored as
 * `.bin` / application/octet-stream), but the legacy plaintext frames remain
 * readable in R2 — the crypto-shredding guarantee does not cover them.
 *
 * This script:
 *  1. Lists all objects under the `frames/` prefix (AC-1)
 *  2. Identifies plaintext frames using defense-in-depth discriminators
 *  3. Deletes them (AC-2) — or reports them in dry-run mode (default)
 *  4. Re-scans to verify zero plaintext frames remain (AC-3)
 *
 * SAFETY:
 *  - DEFAULT IS DRY-RUN. Nothing is deleted unless `--delete` is passed.
 *  - Deletion requires ALL THREE signals to agree (key regex + Content-Type
 *    + magic bytes). Disagreement → flagged for manual review, never deleted.
 *  - S-059 encrypted frames (.bin / application/octet-stream / 0x01 envelope)
 *    are never touched.
 *  - Every action is logged to stdout; pipe to a file for the run record.
 *
 * Usage:
 *   node scripts/r2-plaintext-cleanup.js                                  # dry-run (default)
 *   node scripts/r2-plaintext-cleanup.js --delete --approved-by "Name"    # actually delete
 *   node scripts/r2-plaintext-cleanup.js --provider r2                    # scan R2 only
 *
 * AC-3 SCOPE NOTE: The verification pass confirms "all discriminator-identified
 * plaintext frames were deleted" — it reuses the same three discriminators as
 * the scan, so it cannot detect plaintext outside that set. Code history proves
 * no other legacy format ever existed (both pre-S-059 call sites used identical
 * parameters), but this limitation is stated explicitly.
 *
 * PRE-RUN CHECKLIST (required before --delete):
 *  1. Confirm bucket versioning is OFF on R2 and B2 (script checks this).
 *  2. Obtain Sumanth's explicit approval; pass --approved-by "<name>".
 *  3. Save stdout + the JSON report to docs/sdlc/.../04-implementation/ as
 *     destruction evidence (BIPA §15(a)).
 *  4. Check for CDN/proxy caches in front of frame URLs; purge if applicable.
 *  5. Check DB for retained legacy key strings; clean if present.
 */

const {
	S3Client,
	ListObjectsV2Command,
	HeadObjectCommand,
	GetObjectCommand,
	DeleteObjectCommand,
	GetBucketVersioningCommand,
} = require('@aws-sdk/client-s3');
const { getProviders } = require('../lib/file-storage');

// ── Discriminators (defense in depth) ─────────────────────────────────

/**
 * Legacy plaintext frames were named `video-frame-<timestamp>-<index>.jpg`.
 * S-059 encrypted frames are named `video-frame-<randomhex>.bin`.
 * This regex matches the legacy pattern; .bin keys never match.
 */
const PLAINTEXT_KEY_RE = /^(b2|r2)\/frames\/.*\.jpe?g$/i;

/** S-059 envelope starts with version byte 0x01. */
const ENVELOPE_VERSION_BYTE = 0x01;

/** JPEG files start with the SOI marker FF D8. */
const JPEG_MAGIC = Buffer.from([0xff, 0xd8]);

/**
 * Check if a buffer starts with the S-059 encrypted envelope magic.
 * @param {Buffer|null} buf first bytes of the object
 * @returns {boolean}
 */
function isEncryptedEnvelope(buf) {
	if (!Buffer.isBuffer(buf) || buf.length === 0) return false;
	return buf[0] === ENVELOPE_VERSION_BYTE;
}

/**
 * Check if a buffer starts with JPEG magic bytes.
 * @param {Buffer|null} buf first bytes of the object
 * @returns {boolean}
 */
function isJpegMagic(buf) {
	if (!Buffer.isBuffer(buf) || buf.length < 2) return false;
	return buf[0] === JPEG_MAGIC[0] && buf[1] === JPEG_MAGIC[1];
}

/**
 * Double-check discriminator: key regex + Content-Type must BOTH indicate
 * plaintext. Fail-closed: any doubt → false (never auto-delete).
 *
 * @param {string} key provider-prefixed key (e.g. "r2/frames/....jpg")
 * @param {string|null|undefined} contentType from HeadObject
 * @returns {boolean} true only if both signals agree it's a legacy plaintext frame
 */
function isPlaintextFrame(key, contentType) {
	if (typeof key !== 'string' || !PLAINTEXT_KEY_RE.test(key)) return false;
	if (typeof contentType !== 'string') return false;
	return contentType.toLowerCase().split(';')[0].trim() === 'image/jpeg';
}

/**
 * Triple-check classifier combining all three signals.
 *
 * @param {object} opts
 * @param {string} opts.key provider-prefixed key
 * @param {string|null} opts.contentType from HeadObject
 * @param {Buffer|null} opts.firstBytes first ~4 bytes of the object
 * @returns {{action: 'delete'|'keep'|'review', reason: string}}
 */
function classifyFrame({ key, contentType, firstBytes }) {
	const keySaysPlaintext = typeof key === 'string' && PLAINTEXT_KEY_RE.test(key);
	const typeSaysPlaintext =
		typeof contentType === 'string' &&
		contentType.toLowerCase().split(';')[0].trim() === 'image/jpeg';
	const magicSaysJpeg = isJpegMagic(firstBytes);
	const magicSaysEncrypted = isEncryptedEnvelope(firstBytes);

	// Not a legacy-named file → not our target. Never touch.
	if (!keySaysPlaintext) {
		return { action: 'keep', reason: 'not-legacy-pattern' };
	}

	// Legacy .jpg key: all three signals agree it's plaintext → safe to delete.
	if (typeSaysPlaintext && magicSaysJpeg && !magicSaysEncrypted) {
		return { action: 'delete', reason: 'plaintext' };
	}

	// Legacy-named file but other signals disagree (e.g. .jpg key with
	// ciphertext content-type, or envelope magic bytes) → anomalous, flag
	// for manual review. Never auto-delete on disagreement.
	return { action: 'review', reason: 'ambiguous-signals' };
}

// ── R2/B2 operations ──────────────────────────────────────────────────

function getS3Client(provider) {
	return new S3Client({
		endpoint: provider.endpoint,
		region: provider.region,
		credentials: { accessKeyId: provider.keyId, secretAccessKey: provider.secret },
		forcePathStyle: true,
	});
}

/** List all object keys under the frames/ prefix (paginated). */
async function listFrameKeys(provider) {
	const client = getS3Client(provider);
	const keys = [];
	let continuationToken;
	do {
		const res = await client.send(
			new ListObjectsV2Command({
				Bucket: provider.bucket,
				Prefix: 'frames/',
				ContinuationToken: continuationToken,
				MaxKeys: 1000,
			}),
		);
		for (const obj of res.Contents || []) {
			keys.push({ key: `${provider.name}/${obj.Key}`, size: obj.Size, lastModified: obj.LastModified });
		}
		continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
	} while (continuationToken);
	return keys;
}

/** Fetch Content-Type + first bytes of an object. */
async function inspectObject(provider, prefixedKey) {
	const client = getS3Client(provider);
	const objectKey = prefixedKey.slice(prefixedKey.indexOf('/') + 1);

	const head = await client.send(
		new HeadObjectCommand({ Bucket: provider.bucket, Key: objectKey }),
	);

	let firstBytes = null;
	try {
		const get = await client.send(
			new GetObjectCommand({
				Bucket: provider.bucket,
				Key: objectKey,
				Range: 'bytes=0-3',
			}),
		);
		const chunks = [];
		for await (const chunk of get.Body) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		firstBytes = Buffer.concat(chunks);
	} catch (err) {
		console.warn(`[inspect] Could not fetch magic bytes for ${prefixedKey}: ${err.message}`);
	}

	return { contentType: head.ContentType || null, firstBytes };
}

/** Delete one object. */
async function deleteObject(provider, prefixedKey) {
	const client = getS3Client(provider);
	const objectKey = prefixedKey.slice(prefixedKey.indexOf('/') + 1);
	await client.send(new DeleteObjectCommand({ Bucket: provider.bucket, Key: objectKey }));
}

/**
 * Check if bucket versioning is enabled. If ON, DeleteObject only places a
 * delete marker — the plaintext versions remain recoverable, giving false
 * assurance of biometric destruction. (Privacy HIGH-1)
 *
 * @returns {Promise<boolean>} true if versioning is enabled
 */
async function isVersioningEnabled(provider) {
	const client = getS3Client(provider);
	try {
		const res = await client.send(
			new GetBucketVersioningCommand({ Bucket: provider.bucket }),
		);
		return res.Status === 'Enabled' || res.Status === 'Suspended';
	} catch (err) {
		console.warn(`[warn] Could not check versioning for ${provider.name}: ${err.message}`);
		// Fail-closed: if we can't verify, assume the worst and block deletion.
		return true;
	}
}

// ── Main ──────────────────────────────────────────────────────────────

async function main() {
	const args = process.argv.slice(2);
	const doDelete = args.includes('--delete');
	const approvedByIdx = args.indexOf('--approved-by');
	const approvedBy = approvedByIdx !== -1 ? args[approvedByIdx + 1] : null;
	const providerFilter = args.includes('--provider')
		? args[args.indexOf('--provider') + 1]
		: 'all';

	// Privacy MEDIUM-2: --delete requires explicit --approved-by. The approval
	// gate must be a deliberate act, not an accidental flag.
	if (doDelete && !approvedBy) {
		console.error('ERROR: --delete requires --approved-by "<name>".');
		console.error('Sumanth\'s explicit approval is required before deletion (AGENTS.md rule 4).');
		process.exit(1);
	}

	console.log('=== S-068 R2 Plaintext Frame Cleanup ===');
	console.log(`Mode: ${doDelete ? `DELETE (live, approved by: ${approvedBy})` : 'DRY-RUN (no deletions)'}`);
	console.log(`Provider filter: ${providerFilter}`);
	console.log(`Started: ${new Date().toISOString()}\n`);

	const providers = getProviders().filter(
		(p) => providerFilter === 'all' || p.name === providerFilter,
	);
	if (providers.length === 0) {
		console.error('ERROR: No storage providers configured or matching filter.');
		console.error('Set STORAGE_KEYS_JSON or R2_*/B2_* env vars.');
		process.exit(1);
	}

	// Privacy HIGH-1: verify versioning is OFF before any deletion. If ON,
	// DeleteObject only places a delete marker — plaintext remains recoverable.
	if (doDelete) {
		for (const provider of providers) {
			const versioned = await isVersioningEnabled(provider);
			if (versioned) {
				console.error(
					`ERROR: Bucket versioning is enabled (or unverifiable) on ${provider.name}. ` +
					'DeleteObject would only place a delete marker; plaintext would remain recoverable. ' +
					'Disable versioning or extend this script for version-aware deletion before proceeding.',
				);
				process.exit(1);
			}
			console.log(`[ok] Versioning OFF on ${provider.name}`);
		}
		console.log('');
	}

	const results = { delete: [], keep: 0, review: [], deleted: 0, errors: [] };

	for (const provider of providers) {
		console.log(`--- Scanning provider: ${provider.name} (bucket: ${provider.bucket}) ---`);
		let keys;
		try {
			keys = await listFrameKeys(provider);
		} catch (err) {
			console.error(`[error] List failed for ${provider.name}: ${err.message}`);
			results.errors.push({ provider: provider.name, error: err.message });
			continue;
		}
		console.log(`Found ${keys.length} objects under frames/`);

		for (const { key, size, lastModified } of keys) {
			// Privacy LOW-6 (efficiency): pre-filter by key regex before making
			// HeadObject + Range GET calls. Non-legacy keys are kept without
			// API calls.
			if (!PLAINTEXT_KEY_RE.test(key)) {
				results.keep++;
				continue;
			}

			let contentType = null;
			let firstBytes = null;
			try {
				({ contentType, firstBytes } = await inspectObject(provider, key));
			} catch (err) {
				console.warn(`[warn] Inspect failed for ${key}: ${err.message} → flagged for review`);
				results.review.push({ key, reason: 'inspect-failed', error: err.message });
				continue;
			}

			const { action, reason } = classifyFrame({ key, contentType, firstBytes });

			if (action === 'delete') {
				results.delete.push({ key, size, lastModified, contentType, reason });
				if (doDelete) {
					try {
						await deleteObject(provider, key);
						results.deleted++;
						console.log(`[deleted] ${key}`);
					} catch (err) {
						console.error(`[error] Delete failed for ${key}: ${err.message}`);
						results.errors.push({ key, error: err.message });
					}
				} else {
					console.log(`[would-delete] ${key} (${size} bytes, ${contentType})`);
				}
			} else if (action === 'review') {
				results.review.push({ key, size, contentType, reason });
				console.log(`[review] ${key} — ambiguous signals (${reason}), NOT deleted`);
			} else {
				results.keep++;
			}
		}
	}

	// ── Verification pass (AC-3) ──
	console.log('\n--- Verification pass ---');
	let remainingPlaintext = 0;
	for (const provider of providers) {
		try {
			const keys = await listFrameKeys(provider);
			for (const { key } of keys) {
				// Quick check: key regex + content-type only (no magic fetch needed
				// for verification — if it matches the legacy pattern it's suspect).
				if (PLAINTEXT_KEY_RE.test(key)) {
					const { contentType } = await inspectObject(provider, key);
					if (isPlaintextFrame(key, contentType)) {
						remainingPlaintext++;
						console.log(`[remaining] ${key}`);
					}
				}
			}
		} catch (err) {
			console.error(`[error] Verification scan failed for ${provider.name}: ${err.message}`);
		}
	}

	// ── Summary ──
	console.log('\n=== Summary ===');
	console.log(`Scanned providers: ${providers.map((p) => p.name).join(', ')}`);
	console.log(`Plaintext frames identified: ${results.delete.length}`);
	console.log(`Deleted: ${results.deleted}`);
	console.log(`Kept (S-059 encrypted): ${results.keep}`);
	console.log(`Flagged for manual review: ${results.review.length}`);
	console.log(`Errors: ${results.errors.length}`);
	console.log(`Plaintext frames remaining (verification): ${remainingPlaintext}`);
	console.log(`Finished: ${new Date().toISOString()}`);

	if (!doDelete && results.delete.length > 0) {
		console.log('\nDRY-RUN complete. To delete, re-run with --delete --approved-by "<name>" (requires Sumanth\'s approval).');
	}
	if (doDelete && remainingPlaintext > 0) {
		console.log('\nWARNING: plaintext frames remain after deletion pass. Investigate before closing S-068.');
	}

	// Privacy MEDIUM-3: emit machine-readable JSON report for the audit file
	// (BIPA §15(a) destruction evidence). Save stdout + this JSON to
	// docs/sdlc/.../04-implementation/ and reference in the PR body.
	const fs = require('node:fs');
	const path = require('node:path');
	const report = {
		story: 'S-068',
		issue: 721,
		mode: doDelete ? 'delete' : 'dry-run',
		approvedBy: approvedBy || null,
		startedAt: new Date().toISOString(),
		providers: providers.map((p) => p.name),
		summary: {
			plaintextIdentified: results.delete.length,
			deleted: results.deleted,
			kept: results.keep,
			flaggedForReview: results.review.length,
			errors: results.errors.length,
			plaintextRemaining: remainingPlaintext,
		},
		deleted: results.delete.map((d) => ({ key: d.key, size: d.size, contentType: d.contentType })),
		flaggedForReview: results.review,
		errors: results.errors,
	};
	const reportPath = path.join(
		__dirname,
		`r2-plaintext-cleanup-report-${new Date().toISOString().slice(0, 10)}.json`,
	);
	fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
	console.log(`\nJSON audit report written to: ${reportPath}`);

	if (doDelete && remainingPlaintext > 0) {
		process.exit(2);
	}
	if (results.errors.length > 0) {
		process.exit(1);
	}
}

if (require.main === module) {
	main().catch((err) => {
		console.error('Fatal:', err);
		process.exit(1);
	});
}

module.exports = {
	PLAINTEXT_KEY_RE,
	ENVELOPE_VERSION_BYTE,
	isEncryptedEnvelope,
	isJpegMagic,
	isPlaintextFrame,
	classifyFrame,
	isVersioningEnabled,
};
