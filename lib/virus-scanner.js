/**
 * Lightweight file virus scanner
 * Scans file buffers before upload for suspicious patterns, executable signatures,
 * and MIME type mismatches. Does NOT replace a proper AV engine (ClamAV) but
 * provides a baseline defense layer.
 *
 * Usage:
 *   const { scanFile } = require('../lib/virus-scanner');
 *   const result = await scanFile(buffer, mimetype, filename);
 *   if (!result.clean) { reject upload; }
 */

const _crypto = require('node:crypto');

// ── Known bad signatures / suspicious byte patterns ──
const SUSPICIOUS_PATTERNS = [
	// Windows executable / DLL
	{ signature: Buffer.from([0x4d, 0x5a]), label: 'PE/EXE header (MZ)' },
	// ELF binary
	{ signature: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), label: 'ELF binary header' },
	// Mach-O binary
	{ signature: Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), label: 'Mach-O binary (64-bit)' },
	{ signature: Buffer.from([0xce, 0xfa, 0xed, 0xfe]), label: 'Mach-O binary (32-bit)' },
	// Shebang scripts
	{ signature: Buffer.from('#!/'), label: 'Shebang script' },
	// PDF with embedded JavaScript (common exploit vector)
	{ signature: Buffer.from('/JavaScript'), label: 'PDF JavaScript tag' },
	{ signature: Buffer.from('/JS'), label: 'PDF JS action' },
	{ signature: Buffer.from('/OpenAction'), label: 'PDF OpenAction' },
	// Office macros
	{ signature: Buffer.from('macros'), label: 'Macro reference' },
	{ signature: Buffer.from('VBA'), label: 'VBA reference' },
	// Common shellcode patterns
	{ signature: Buffer.from('cmd.exe'), label: 'cmd.exe reference' },
	{ signature: Buffer.from('powershell'), label: 'PowerShell reference' },
	{ signature: Buffer.from('eval('), label: 'JavaScript eval()' },
	{ signature: Buffer.from('document.write'), label: 'document.write()' },
	{ signature: Buffer.from('<script'), label: 'HTML script tag' },
	{ signature: Buffer.from('WScript.Shell'), label: 'WScript.Shell reference' },
	{ signature: Buffer.from('CreateObject'), label: 'CreateObject reference' },
	// SQL injection / common payloads
	{ signature: Buffer.from('UNION SELECT'), label: 'SQL injection pattern' },
	{ signature: Buffer.from('xp_cmdshell'), label: 'SQL xp_cmdshell' },
];

// ── Expected magic numbers for allowed MIME types ──
const MAGIC_NUMBERS = {
	'application/pdf': { magic: Buffer.from('%PDF'), offset: 0 },
	'image/jpeg': { magic: Buffer.from([0xff, 0xd8, 0xff]), offset: 0 },
	'image/jpg': { magic: Buffer.from([0xff, 0xd8, 0xff]), offset: 0 },
	'image/png': { magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]), offset: 0 },
	'image/webp': { magic: Buffer.from([0x52, 0x49, 0x46, 0x46]), offset: 0 },
	'application/msword': { magic: Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), offset: 0 }, // OLE2
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
		magic: Buffer.from('PK\x03\x04'),
		offset: 0,
	}, // ZIP (DOCX is a ZIP)
};

// ── Entropy threshold for packed / encrypted payloads ──
const ENTROPY_THRESHOLD = 7.8; // Shannon entropy max is 8.0 for random data

/**
 * Calculate Shannon entropy of a buffer (0 = predictable, 8 = random).
 */
function calculateEntropy(buffer) {
	const freq = new Map();
	for (let i = 0; i < buffer.length; i++) {
		freq.set(buffer[i], (freq.get(buffer[i]) || 0) + 1);
	}
	let entropy = 0;
	const len = buffer.length;
	for (const count of freq.values()) {
		const p = count / len;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

/**
 * Search for suspicious byte patterns in the buffer.
 */
function findSuspiciousPatterns(buffer) {
	const findings = [];
	for (const pattern of SUSPICIOUS_PATTERNS) {
		let idx = 0;
		while (true) {
			idx = buffer.indexOf(pattern.signature, idx);
			if (idx === -1) break;
			findings.push({
				label: pattern.label,
				offset: idx,
				bytes: pattern.signature.toString('hex'),
			});
			idx += pattern.signature.length;
		}
	}
	return findings;
}

/**
 * Validate that the file magic number matches the declared MIME type.
 */
function validateMagicNumber(buffer, mimetype) {
	const expected = MAGIC_NUMBERS[mimetype];
	if (!expected) {
		// Unknown MIME type — allow (let multer filter handle it)
		return { valid: true };
	}
	const actual = buffer.subarray(expected.offset, expected.offset + expected.magic.length);
	if (Buffer.compare(actual, expected.magic) !== 0) {
		return {
			valid: false,
			reason: `Magic number mismatch for ${mimetype}. Expected ${expected.magic.toString('hex')}, got ${actual.toString('hex')}`,
		};
	}
	return { valid: true };
}

/**
 * Scan a file buffer.
 *
 * @param {Buffer} buffer
 * @param {string} mimetype
 * @param {string} filename
 * @returns {{clean: boolean, findings: Array, reason?: string}}
 */
function scanFile(buffer, mimetype, filename) {
	const findings = [];

	// 1. File size sanity check (should already be enforced by multer)
	if (buffer.length > 50 * 1024 * 1024) {
		return { clean: false, findings: [{ type: 'size', reason: 'File exceeds 50MB' }] };
	}

	// 2. MIME type magic number validation
	const magicResult = validateMagicNumber(buffer, mimetype);
	if (!magicResult.valid) {
		findings.push({ type: 'magic_mismatch', reason: magicResult.reason });
	}

	// 3. Suspicious pattern scan
	const patternFindings = findSuspiciousPatterns(buffer);
	if (patternFindings.length > 0) {
		findings.push(
			...patternFindings.map((f) => ({
				type: 'suspicious_pattern',
				...f,
			})),
		);
	}

	// 4. Entropy check (packed / encrypted payloads)
	const entropy = calculateEntropy(buffer);
	if (entropy > ENTROPY_THRESHOLD) {
		findings.push({
			type: 'high_entropy',
			reason: `High entropy detected (${entropy.toFixed(2)} / 8.0) — possible packed or encrypted payload`,
			entropy,
		});
	}

	// 5. Executable file detection (regardless of declared MIME type)
	const isExecutable = buffer[0] === 0x4d && buffer[1] === 0x5a; // MZ header
	if (isExecutable) {
		findings.push({
			type: 'executable',
			reason: 'Executable file header (MZ/PE) detected',
		});
	}

	// Determine verdict
	// - High severity: executable, high entropy → always reject
	// - Medium severity: suspicious patterns in allowed file types → reject
	// - Low severity: magic mismatch alone → log but may still reject

	const highSeverity = findings.filter((f) => f.type === 'executable' || f.type === 'high_entropy');
	const mediumSeverity = findings.filter((f) => f.type === 'suspicious_pattern');

	if (highSeverity.length > 0) {
		return {
			clean: false,
			findings,
			reason: `High-risk file detected: ${highSeverity.map((f) => f.reason).join('; ')}`,
			filename,
			mimetype,
		};
	}

	if (mediumSeverity.length > 0) {
		return {
			clean: false,
			findings,
			reason: `Suspicious patterns found (${mediumSeverity.length}): ${mediumSeverity[0].label}${mediumSeverity.length > 1 ? ' (and more)' : ''}`,
			filename,
			mimetype,
		};
	}

	if (!magicResult.valid) {
		// Magic mismatch without other issues — log as warning but reject for safety
		return {
			clean: false,
			findings,
			reason: `File type validation failed: ${magicResult.reason}`,
			filename,
			mimetype,
		};
	}

	return {
		clean: true,
		findings: [],
		entropy: parseFloat(entropy.toFixed(2)),
		filename,
		mimetype,
	};
}

/**
 * Log a scan event to the audit system (non-blocking).
 */
async function logScanEvent(userId, filename, mimetype, result, req = null) {
	try {
		const pool = require('./db');
		await pool.query(
			`
      INSERT INTO document_scan_logs (
        user_id, filename, mime_type, clean, findings, scanned_at, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7)
    `,
			[
				userId,
				filename,
				mimetype,
				result.clean,
				JSON.stringify(result.findings || []),
				req?.ip || null,
				req?.headers?.['user-agent'] || null,
			],
		);
	} catch (err) {
		// Non-blocking — if the table doesn't exist yet, just log to console
		console.warn('[virus-scanner] Failed to log scan event:', err.message);
	}
}

module.exports = {
	scanFile,
	logScanEvent,
	calculateEntropy,
	findSuspiciousPatterns,
	validateMagicNumber,
};
