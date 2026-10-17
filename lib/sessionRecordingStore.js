/**
 * sessionRecordingStore — DEK encryption for LiveKit egress recordings
 * (GAP-A2, #1130, STOP 1 R-1…R-8).
 *
 * LiveKit egress lands a PLAINTEXT MP4 in the RECORDING_STORAGE_* bucket.
 * At completion (server/services/livekit.js completeRecordingRecord, the
 * single choke point) the landed object is encrypted under the candidate's
 * DEK (lib/biometricCrypto) and the plaintext is deleted — fail-closed:
 * a recording reaches status='completed' only through this path.
 *
 * Design:
 *  - Envelope: r2FrameStore.packEnvelope (0x01 || iv(12) || tag(16) ||
 *    ciphertext), AES-256-GCM via biometricCrypto. NEW AAD namespace
 *    binding candidate + recording id:
 *    `r2sessionrecording:v1:candidate:<id>:recording:<id>` — integer-
 *    validated components (r2ObserverAudioStore precedent). AAD is
 *    reconstructed from the authoritative DB row, never object metadata.
 *  - Storage is addressed ONLY by the RECORDING_STORAGE_* configuration
 *    (R-4): this module's own S3 client talks to the egress bucket; it
 *    never assumes lib/file-storage provider buckets coincide with it.
 *    A location naming a different bucket fails closed.
 *  - The .enc key is deterministic (`<plaintext key>.enc`, same bucket),
 *    so a completion retry re-uses the same object and registry row —
 *    no orphan second .enc.
 *  - One shared size cap (R-2): MAX_SESSION_RECORDING_BYTES is the
 *    existing decrypt-path cap class (r2RecordingStore's 50 MB plaintext
 *    cap). Downloads are counting streams that abort over the cap.
 *  - Decrypt paths use the EXISTING DEK only (decryptWithExistingDEK) —
 *    never mint-on-read.
 */

const {
	S3Client,
	GetObjectCommand,
	PutObjectCommand,
	DeleteObjectCommand,
	HeadObjectCommand,
} = require('@aws-sdk/client-s3');
const { encryptWithDEK, decryptWithExistingDEK } = require('./biometricCrypto');
const { packEnvelope, unpackEnvelope } = require('./r2FrameStore');
const { MAX_PLAINTEXT_BYTES } = require('./r2RecordingStore');

const SESSION_RECORDING_AAD_PREFIX = 'r2sessionrecording:v1:candidate:';
const MAX_SESSION_RECORDING_BYTES = MAX_PLAINTEXT_BYTES;
const MAX_ENVELOPE_BYTES = MAX_SESSION_RECORDING_BYTES + 1024; // envelope overhead + slack (r2RecordingStore precedent)
// Marker written to interview_recordings.encryption_key_id for recordings
// completed through this path (consumers branch on this + the .enc key,
// never on decrypt failure — R-7).
const ENCRYPTION_KEY_ID = 'candidate-dek:v1';

function _codedError(code, message, extra = {}) {
	const err = new Error(message);
	err.code = code;
	return Object.assign(err, extra);
}

function _assertIntegerIds(ids) {
	for (const v of ids) {
		if (!Number.isInteger(v)) {
			throw _codedError('INVALID_ID', 'sessionRecordingStore: AAD components must be integers');
		}
	}
}

/** AAD binding candidate + recording id (both integers, from the DB row). */
function sessionRecordingAAD(candidateId, recordingId) {
	const c = Number(candidateId);
	const r = Number(recordingId);
	_assertIntegerIds([c, r]);
	return `${SESSION_RECORDING_AAD_PREFIX}${c}:recording:${r}`;
}

// ─── RECORDING_STORAGE_* addressing (R-4) ────────────────────────────────

function getRecordingStorageConfig() {
	const bucket = process.env.RECORDING_STORAGE_BUCKET;
	const accessKey = process.env.RECORDING_STORAGE_ACCESS_KEY;
	const secretKey = process.env.RECORDING_STORAGE_SECRET_KEY;
	if (!bucket || !accessKey || !secretKey) {
		throw _codedError(
			'CONFIG_ERROR',
			'sessionRecordingStore: RECORDING_STORAGE_BUCKET / RECORDING_STORAGE_ACCESS_KEY / RECORDING_STORAGE_SECRET_KEY required',
		);
	}
	return {
		bucket,
		region: process.env.RECORDING_STORAGE_REGION || 'auto',
		endpoint: process.env.RECORDING_STORAGE_ENDPOINT || undefined,
		accessKey,
		secretKey,
	};
}

let _client = null;
function _getClient() {
	if (_client) return _client;
	const cfg = getRecordingStorageConfig();
	_client = new S3Client({
		endpoint: cfg.endpoint,
		region: cfg.region,
		credentials: { accessKeyId: cfg.accessKey, secretAccessKey: cfg.secretKey },
		forcePathStyle: true,
	});
	return _client;
}

/**
 * Parse an egress file location into { bucket, key }.
 * Forms seen in-repo: `s3://<bucket>/<key>`, `https://<host>/<bucket>/<key>`
 * (the downloadRecordingAudio / GAP-A drain forms), or a bare key.
 */
function parseRecordingLocation(location) {
	if (typeof location !== 'string' || !location) {
		throw _codedError('INVALID_LOCATION', 'sessionRecordingStore: recording location is required');
	}
	const s3Match = location.match(/^s3:\/\/([^/]+)\/(.+)$/);
	if (s3Match) return { bucket: s3Match[1], key: s3Match[2] };
	const httpMatch = location.match(/^https?:\/\/[^/]+\/([^/]+)\/(.+)$/);
	if (httpMatch) return { bucket: httpMatch[1], key: httpMatch[2] };
	return { bucket: null, key: location.replace(/^\/+/, '') };
}

/** Resolve a location to the egress-bucket key, failing closed on bucket mismatch. */
function _keyForLocation(location) {
	const cfg = getRecordingStorageConfig();
	const { bucket, key } = parseRecordingLocation(location);
	if (bucket && bucket !== cfg.bucket) {
		throw _codedError(
			'BUCKET_MISMATCH',
			`sessionRecordingStore: location bucket does not match the RECORDING_STORAGE bucket — failing closed, no bucket guessed`,
			{ nonRetryable: true },
		);
	}
	return key;
}

function encKeyForKey(key) {
	return key.endsWith('.enc') ? key : `${key}.enc`;
}

/** The .enc location (GAP-A inventory form) for a plaintext location. */
function encLocationFor(location) {
	const cfg = getRecordingStorageConfig();
	const key = _keyForLocation(location);
	return `s3://${cfg.bucket}/${encKeyForKey(key)}`;
}

// ─── Object operations on the egress bucket ──────────────────────────────

async function _streamToBuffer(stream, maxBytes) {
	const chunks = [];
	let total = 0;
	for await (const chunk of stream) {
		const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
		total += buf.length;
		if (total > maxBytes) {
			if (typeof stream.destroy === 'function') stream.destroy();
			throw _codedError(
				'RECORDING_TOO_LARGE',
				`sessionRecordingStore: object exceeds ${maxBytes} bytes`,
			);
		}
		chunks.push(buf);
	}
	return Buffer.concat(chunks);
}

/** Download an egress-bucket object with a counting-stream cap. */
async function downloadRecordingObject(location, { maxBytes = MAX_ENVELOPE_BYTES } = {}) {
	const cfg = getRecordingStorageConfig();
	const key = _keyForLocation(location);
	let res;
	try {
		res = await _getClient().send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
	} catch (err) {
		if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
			throw _codedError('NOT_FOUND', 'sessionRecordingStore: recording object not found');
		}
		throw err;
	}
	return _streamToBuffer(res.Body, maxBytes);
}

/** True when the object exists in the egress bucket. */
async function recordingObjectExists(location) {
	const cfg = getRecordingStorageConfig();
	const key = _keyForLocation(location);
	try {
		await _getClient().send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
		return true;
	} catch (err) {
		if (
			err.name === 'NotFound' ||
			err.name === 'NoSuchKey' ||
			err.$metadata?.httpStatusCode === 404
		) {
			return false;
		}
		throw err;
	}
}

/** Upload the ciphertext envelope at the deterministic .enc key. */
async function uploadEncryptedObject(plaintextLocation, envelope) {
	const cfg = getRecordingStorageConfig();
	const encKey = encKeyForKey(_keyForLocation(plaintextLocation));
	await _getClient().send(
		new PutObjectCommand({
			Bucket: cfg.bucket,
			Key: encKey,
			Body: envelope,
			ContentType: 'application/octet-stream',
		}),
	);
	return { encKey, encLocation: `s3://${cfg.bucket}/${encKey}` };
}

/**
 * Verified delete (R-4): DeleteObject, then an existence check. The
 * file-storage deleteStorageObject soft-fails — an unchecked return here
 * would be a defect, so any doubt throws.
 */
async function deleteRecordingObjectVerified(location) {
	const cfg = getRecordingStorageConfig();
	const key = _keyForLocation(location);
	await _getClient().send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
	if (await recordingObjectExists(location)) {
		throw _codedError(
			'DELETE_VERIFY_FAILED',
			'sessionRecordingStore: object still exists after delete',
		);
	}
	return true;
}

// ─── Envelope encrypt / decrypt ──────────────────────────────────────────

/** Encrypt plaintext under the candidate's DEK (mints if absent — caller's preflight governs). */
async function encryptSessionRecording(plaintext, candidateId, recordingId) {
	const aad = sessionRecordingAAD(candidateId, recordingId);
	const { ciphertext, iv, tag } = await encryptWithDEK(plaintext, Number(candidateId), aad);
	return packEnvelope({ iv, tag, ciphertext });
}

/** Decrypt an envelope with the candidate's EXISTING DEK (never mints). */
async function decryptSessionRecording(envelope, candidateId, recordingId) {
	const aad = sessionRecordingAAD(candidateId, recordingId);
	const { iv, tag, ciphertext } = unpackEnvelope(envelope);
	return decryptWithExistingDEK(ciphertext, iv, tag, Number(candidateId), aad);
}

/**
 * Marker check (R-7): a recording is on the encrypted path when its row
 * carries the encryption_key_id marker or its decrypted pointer names an
 * .enc object. Consumers branch on this, never on decrypt failure.
 */
function isEncryptedRecording(recording, decryptedPath) {
	if (!recording) return false;
	if (recording.encryption_key_id === ENCRYPTION_KEY_ID) return true;
	return typeof decryptedPath === 'string' && decryptedPath.endsWith('.enc');
}

module.exports = {
	SESSION_RECORDING_AAD_PREFIX,
	MAX_SESSION_RECORDING_BYTES,
	MAX_ENVELOPE_BYTES,
	ENCRYPTION_KEY_ID,
	sessionRecordingAAD,
	getRecordingStorageConfig,
	parseRecordingLocation,
	encLocationFor,
	downloadRecordingObject,
	recordingObjectExists,
	uploadEncryptedObject,
	deleteRecordingObjectVerified,
	encryptSessionRecording,
	decryptSessionRecording,
	isEncryptedRecording,
	_clearClient: () => {
		_client = null;
	},
};
