/**
 * PKCS#7 / CMS Detached Signature Utility
 *
 * Provides cryptographic primitives for e-signature engine:
 *   - SHA-256 (and SHA-384/512) document hashing with tamper detection
 *   - PKCS#7 detached signature generation using Node.js native crypto
 *   - Signature verification with certificate chain validation helpers
 *   - PEM/DER conversion utilities
 *
 * NOTE: This module uses Node.js native `crypto` for all operations.
 * The PKCS#7 structure is encoded manually in ASN.1/DER to avoid
 * external dependencies. If full CMS compliance is required later,
 * swap in `node-forge` or `pkijs` without changing the public API.
 *
 * @module server/utils/pkcs7
 */

const crypto = require('node:crypto');

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const OID = {
	// Digest algorithms
	sha256: '2.16.840.1.101.3.4.2.1',
	sha384: '2.16.840.1.101.3.4.2.2',
	sha512: '2.16.840.1.101.3.4.2.3',

	// Signature algorithms
	rsaEncryption: '1.2.840.113549.1.1.1',
	rsaSHA256: '1.2.840.113549.1.1.11',
	rsaSHA384: '1.2.840.113549.1.1.12',
	rsaSHA512: '1.2.840.113549.1.1.13',

	// Content types
	data: '1.2.840.113549.1.7.1',
	signedData: '1.2.840.113549.1.7.2',

	// PKCS#9 attributes
	contentType: '1.2.840.113549.1.9.3',
	messageDigest: '1.2.840.113549.1.9.4',
	signingTime: '1.2.840.113549.1.9.5',
};

const HASH_ALG_MAP = {
	sha256: { oid: OID.sha256, nodeName: 'sha256', digestLength: 32 },
	sha384: { oid: OID.sha384, nodeName: 'sha384', digestLength: 48 },
	sha512: { oid: OID.sha512, nodeName: 'sha512', digestLength: 64 },
};

// ─────────────────────────────────────────────────────────────────────────────
// Low-level ASN.1 / DER helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a DER tag-length-value triple.
 * @param {number} tagClass — 0 = universal, 2 = context-specific
 * @param {number} tagNumber
 * @param {boolean} constructed
 * @param {Buffer} value
 * @returns {Buffer}
 */
function derTlv(tagClass, tagNumber, constructed, value) {
	const classBits = tagClass << 6;
	const constructedBit = constructed ? 0x20 : 0x00;
	const tagByte = classBits | constructedBit | (tagNumber & 0x1f);
	if (tagNumber > 30) {
		throw new Error('Multi-byte tag numbers not supported');
	}

	const len = value.length;
	let lenBytes;
	if (len < 128) {
		lenBytes = Buffer.from([len]);
	} else if (len < 256) {
		lenBytes = Buffer.from([0x81, len]);
	} else if (len < 65536) {
		lenBytes = Buffer.from([0x82, len >> 8, len & 0xff]);
	} else {
		throw new Error('Value too long for DER');
	}

	return Buffer.concat([Buffer.from([tagByte]), lenBytes, value]);
}

/** Universal primitive types */
const u = {
	integer: (n) => derTlv(0, 0x02, false, n),
	bitString: (buf) => {
		// prepend unused-bits byte (0)
		const payload = Buffer.concat([Buffer.from([0x00]), buf]);
		return derTlv(0, 0x03, false, payload);
	},
	octetString: (buf) => derTlv(0, 0x04, false, buf),
	null: () => derTlv(0, 0x05, false, Buffer.alloc(0)),
	oid: (oidStr) => {
		const parts = oidStr.split('.').map(Number);
		const first = parts[0] * 40 + parts[1];
		const rest = [];
		for (let i = 2; i < parts.length; i++) {
			let v = parts[i];
			const bytes = [];
			if (v === 0) {
				bytes.push(0);
			} else {
				const stack = [];
				while (v > 0) {
					stack.unshift((v & 0x7f) | 0x80);
					v = v >> 7;
				}
				stack[stack.length - 1] &= 0x7f;
				bytes.push(...stack);
			}
			rest.push(...bytes);
		}
		return derTlv(0, 0x06, false, Buffer.from([first, ...rest]));
	},
	sequence: (items) => derTlv(0, 0x10, true, Buffer.concat(items)),
	set: (items) => derTlv(0, 0x11, true, Buffer.concat(items)),
	utcTime: (date) => {
		const s = date.toISOString().replace(/[-:]/g, '').slice(2, 14) + 'Z';
		return derTlv(0, 0x17, false, Buffer.from(s, 'ascii'));
	},
	ia5String: (str) => derTlv(0, 0x16, false, Buffer.from(str, 'ascii')),
	printableString: (str) => derTlv(0, 0x13, false, Buffer.from(str, 'ascii')),
};

/** Context-specific constructed [0] wrapper */
function ctx0(items) {
	return derTlv(2, 0x00, true, Buffer.concat(items));
}

// ─────────────────────────────────────────────────────────────────────────────
// Document Hashing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a cryptographic hash of document content.
 * @param {Buffer|string} content — raw document bytes or string
 * @param {string} algorithm — 'sha256' | 'sha384' | 'sha512'
 * @returns {string} — lowercase hex digest
 */
function computeDocumentHash(content, algorithm = 'sha256') {
	const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
	const hash = crypto.createHash(algorithm);
	hash.update(buf);
	return hash.digest('hex').toLowerCase();
}

/**
 * Verify that a document's content matches the stored hash.
 * @param {Buffer|string} content
 * @param {string} expectedHash — hex digest
 * @param {string} algorithm
 * @returns {{ valid: boolean, computedHash: string, error?: string }}
 */
function verifyDocumentHash(content, expectedHash, algorithm = 'sha256') {
	try {
		const computed = computeDocumentHash(content, algorithm);
		const expected = expectedHash.toLowerCase().trim();
		if (computed !== expected) {
			return {
				valid: false,
				computedHash: computed,
				error: `Hash mismatch: expected ${expected.slice(0, 16)}…, got ${computed.slice(0, 16)}…`,
			};
		}
		return { valid: true, computedHash: computed };
	} catch (err) {
		return { valid: false, computedHash: null, error: err.message };
	}
}

/**
 * Compute a Merkle-like chain hash from a sequence of hashes.
 * Used to build tamper-evident chains in document_hash_records.
 * @param {string} previousHash — hex digest or empty string
 * @param {string} currentHash — hex digest
 * @param {string} algorithm
 * @returns {string} — hex digest of chain hash
 */
function computeChainHash(previousHash, currentHash, algorithm = 'sha256') {
	const hash = crypto.createHash(algorithm);
	hash.update(Buffer.from(previousHash || '', 'hex'));
	hash.update(Buffer.from(currentHash, 'hex'));
	// Add a domain separator to prevent collision with simple concatenation
	hash.update(Buffer.from('REKRUT-SIG-CHAIN-v1'));
	return hash.digest('hex').toLowerCase();
}

/**
 * Compute a hash of structured audit event data for the audit chain.
 * @param {Object} eventData — JSON-serializable event payload
 * @param {string} algorithm
 * @returns {string} — hex digest
 */
function computeEventHash(eventData, algorithm = 'sha256') {
	const canonical = JSON.stringify(eventData, Object.keys(eventData).sort());
	const hash = crypto.createHash(algorithm);
	hash.update(Buffer.from(canonical, 'utf8'));
	return hash.digest('hex').toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────────
// PKCS#7 Detached Signature (Simplified CMS)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a PKCS#7 detached signature over a document hash.
 *
 * The signature does NOT include the document content (detached mode).
 * It signs the hash of the document, along with authenticated attributes
 * (contentType and messageDigest) per RFC 5652.
 *
 * @param {string} documentHash — hex-encoded SHA-256 digest of the document
 * @param {Object} options
 * @param {crypto.KeyObject} options.privateKey — RSA private key
 * @param {string} options.certPem — X.509 certificate in PEM format (optional)
 * @param {string} options.hashAlg — 'sha256' | 'sha384' | 'sha512'
 * @param {Date} options.signingTime — timestamp of signing
 * @returns {{ signatureB64: string, signedHash: string, pkcs7Der: Buffer }}
 */
function createPKCS7DetachedSignature(documentHash, options) {
	const { privateKey, certPem = null, hashAlg = 'sha256', signingTime = new Date() } = options;

	const hashInfo = HASH_ALG_MAP[hashAlg];
	if (!hashInfo) {
		throw new Error(`Unsupported hash algorithm: ${hashAlg}`);
	}

	// 1. Build authenticated attributes (RFC 5652 § 11.2)
	const digestOctets = Buffer.from(documentHash, 'hex');

	const contentTypeAttr = u.sequence([u.oid(OID.contentType), u.set([u.oid(OID.data)])]);

	const messageDigestAttr = u.sequence([
		u.oid(OID.messageDigest),
		u.set([u.octetString(digestOctets)]),
	]);

	const authenticatedAttributes = u.set([contentTypeAttr, messageDigestAttr]);

	// 2. Sign the authenticated attributes (DER-encoded)
	const signer = crypto.createSign('RSA-SHA256');
	signer.update(authenticatedAttributes);
	const signatureValue = signer.sign(privateKey);

	// 3. Build SignerInfo
	//   issuerAndSerialNumber (placeholder if no cert provided)
	let issuerSerial;
	if (certPem) {
		const certDer = pemToDer(certPem);
		// For a real implementation we'd parse the issuer name and serial from cert.
		// Here we use a simplified placeholder that includes the cert hash.
		const certHash = crypto.createHash(hashAlg).update(certDer).digest();
		issuerSerial = u.sequence([
			// DirectoryName placeholder
			u.sequence([]),
			u.integer(Buffer.from('01', 'hex')),
		]);
	} else {
		issuerSerial = u.sequence([u.sequence([]), u.integer(Buffer.from('00', 'hex'))]);
	}

	const digestAlgorithm = u.sequence([u.oid(hashInfo.oid), u.null()]);

	const signatureAlgorithm = u.sequence([u.oid(OID.rsaSHA256), u.null()]);

	const authenticatedAttributesCtx = ctx0([authenticatedAttributes]);

	const signerInfo = u.sequence([
		u.integer(Buffer.from('01', 'hex')), // version
		issuerSerial,
		digestAlgorithm,
		authenticatedAttributesCtx,
		signatureAlgorithm,
		u.octetString(signatureValue),
	]);

	// 4. Build SignedData
	const digestAlgorithms = u.set([digestAlgorithm]);

	const contentInfo = u.sequence([
		u.oid(OID.data),
		// Explicit [0] ContentInfo — empty for detached
		derTlv(2, 0x00, true, Buffer.alloc(0)),
	]);

	const certificates = certPem ? [u.octetString(pemToDer(certPem))] : [];
	const certificatesCtx = certificates.length > 0 ? ctx0(certificates) : Buffer.alloc(0);

	const signerInfos = u.set([signerInfo]);

	let signedDataContent;
	if (certificates.length > 0) {
		signedDataContent = u.sequence([
			u.integer(Buffer.from('01', 'hex')), // version
			digestAlgorithms,
			contentInfo,
			certificatesCtx,
			signerInfos,
		]);
	} else {
		signedDataContent = u.sequence([
			u.integer(Buffer.from('01', 'hex')), // version
			digestAlgorithms,
			contentInfo,
			signerInfos,
		]);
	}

	// 5. Wrap in ContentInfo { signedData }
	const pkcs7Der = u.sequence([u.oid(OID.signedData), derTlv(2, 0x00, true, signedDataContent)]);

	return {
		signatureB64: pkcs7Der.toString('base64'),
		signedHash: documentHash,
		pkcs7Der,
		signingTime: signingTime.toISOString(),
	};
}

/**
 * Verify a PKCS#7 detached signature against a document hash.
 *
 * NOTE: This is a structural verification. Full certificate chain validation
 * (issuer trust, revocation, expiry) should be performed separately via
 * `validateCertificateChain()`.
 *
 * @param {Buffer|string} pkcs7Input — DER bytes or base64-encoded PKCS#7
 * @param {string} documentHash — expected hex digest
 * @param {crypto.KeyObject|string} publicKeyOrCert — RSA public key or X.509 cert PEM
 * @param {string} hashAlg — 'sha256' | 'sha384' | 'sha512'
 * @returns {{ valid: boolean, verifiedAt: string, error?: string }}
 */
function verifyPKCS7DetachedSignature(
	pkcs7Input,
	documentHash,
	publicKeyOrCert,
	hashAlg = 'sha256',
) {
	try {
		let pkcs7Der;
		if (Buffer.isBuffer(pkcs7Input)) {
			pkcs7Der = pkcs7Input;
		} else {
			pkcs7Der = Buffer.from(pkcs7Input, 'base64');
		}

		// Parse the PKCS#7 to extract signature value and authenticated attributes.
		// For the foundation release we do a simplified structural verify:
		// re-derive the public key and verify the RSA signature over the
		// authenticated attributes blob.
		let publicKey;
		if (typeof publicKeyOrCert === 'string' && publicKeyOrCert.includes('CERTIFICATE')) {
			publicKey = crypto.createPublicKey(publicKeyOrCert);
		} else if (typeof publicKeyOrCert === 'object' && publicKeyOrCert.type === 'public') {
			publicKey = publicKeyOrCert;
		} else {
			publicKey = crypto.createPublicKey(publicKeyOrCert);
		}

		// Structural verification: we know the signature covers the hash,
		// so we verify the RSA signature directly over a known digest of
		// the authenticated attributes.  A full ASN.1 parser would walk the
		// SignerInfo, but for the foundation we reconstruct the signed data
		// using the same canonical structure we generate.
		const digestOctets = Buffer.from(documentHash, 'hex');

		const contentTypeAttr = u.sequence([u.oid(OID.contentType), u.set([u.oid(OID.data)])]);

		const messageDigestAttr = u.sequence([
			u.oid(OID.messageDigest),
			u.set([u.octetString(digestOctets)]),
		]);

		// Reconstruct the canonical authenticated attributes set
		const authenticatedAttributes = u.set([contentTypeAttr, messageDigestAttr]);

		const verifier = crypto.createVerify('RSA-SHA256');
		verifier.update(authenticatedAttributes);

		// Extract signature octets from PKCS#7 structure.
		// We scan for the RSA signature blob: it appears after the authenticated
		// attributes context tag [0] inside SignerInfo, followed by
		// signatureAlgorithm and then OCTET STRING (the signature value).
		const sigOctetOffset = findSignatureOctetString(pkcs7Der);
		if (sigOctetOffset < 0) {
			return {
				valid: false,
				verifiedAt: null,
				error: 'Could not locate signature value in PKCS#7',
			};
		}

		const { value: sigBytes, nextOffset: _next } = parseDerTlvAt(pkcs7Der, sigOctetOffset);
		const valid = verifier.verify(publicKey, sigBytes);

		return {
			valid,
			verifiedAt: new Date().toISOString(),
			error: valid ? undefined : 'RSA signature verification failed',
		};
	} catch (err) {
		return { valid: false, verifiedAt: null, error: err.message };
	}
}

// ─────────────────────────────────────────────────────────────────────────────
// Certificate / PEM helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert PEM to DER.
 * @param {string} pem
 * @returns {Buffer}
 */
function pemToDer(pem) {
	const base64 = pem
		.replace(/-----BEGIN [^-]+-----/, '')
		.replace(/-----END [^-]+-----/, '')
		.replace(/\s/g, '');
	return Buffer.from(base64, 'base64');
}

/**
 * Convert DER to PEM certificate.
 * @param {Buffer} der
 * @returns {string}
 */
function derToPem(der, label = 'CERTIFICATE') {
	const b64 = der.toString('base64');
	const lines = b64.match(/.{1,64}/g) || [];
	return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----`;
}

/**
 * Generate a self-signed RSA key pair for testing / development signing.
 * In production, keys should come from an HSM or secure key management service.
 *
 * @param {number} keySize — RSA key size (default 2048)
 * @returns {{ privateKeyPem: string, publicKeyPem: string, keyPair: crypto.KeyPairSyncResult<string, string> }}
 */
function generateTestKeyPair(keySize = 2048) {
	const keyPair = crypto.generateKeyPairSync('rsa', {
		modulusLength: keySize,
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});

	return {
		privateKeyPem: keyPair.privateKey,
		publicKeyPem: keyPair.publicKey,
		keyPair,
	};
}

/**
 * Validate a certificate chain (placeholder for full implementation).
 *
 * A production implementation would:
 *  1. Parse each certificate in the chain
 *  2. Verify issuer signatures
 *  3. Check validity dates (notBefore, notAfter)
 *  4. Check revocation via CRL or OCSP
 *  5. Verify root CA trust
 *  6. Check certificate policies and EKU
 *
 * @param {string[]} certChainPem — array of certs from end-entity to root
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateCertificateChain(certChainPem) {
	const errors = [];

	if (!certChainPem || certChainPem.length === 0) {
		errors.push('No certificates provided');
		return { valid: false, errors };
	}

	// Foundation: basic structural validation
	for (let i = 0; i < certChainPem.length; i++) {
		const cert = certChainPem[i];
		if (!cert.includes('BEGIN CERTIFICATE')) {
			errors.push(`Certificate ${i}: invalid PEM format`);
			continue;
		}
		try {
			const _key = crypto.createPublicKey(cert);
			// Successfully parsed
		} catch (err) {
			errors.push(`Certificate ${i}: parse error — ${err.message}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

// ─────────────────────────────────────────────────────────────────────────────
// DER parsing helpers (minimal, for signature verification)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Find the offset of the signature OCTET STRING inside a PKCS#7 SignedData.
 * This is a simple scanner that looks for the last OCTET STRING before
 * the end of SignerInfo, which conventionally holds the RSA signature value.
 */
function findSignatureOctetString(der) {
	// Walk backwards from near the end to find the last OCTET STRING (0x04)
	// that is long enough to be an RSA signature (≥ 128 bytes for 1024-bit key).
	// For 2048-bit RSA, signature is 256 bytes.
	const minSigLen = 128;
	for (let i = der.length - 1; i >= 2; i--) {
		if (der[i - 2] === 0x04) {
			const lenByte = der[i - 1];
			let len;
			let hdrLen = 2;
			if ((lenByte & 0x80) === 0) {
				len = lenByte;
			} else {
				const numLenBytes = lenByte & 0x7f;
				if (numLenBytes === 1) {
					len = der[i];
					hdrLen = 3;
				} else if (numLenBytes === 2) {
					len = (der[i - 0] << 8) | der[i + 1];
					hdrLen = 4;
				} else {
					continue;
				}
			}
			if (len >= minSigLen && i - hdrLen + len < der.length) {
				return i - 2;
			}
		}
	}
	return -1;
}

/**
 * Parse a DER TLV at a given offset.
 * @returns {{ tag: number, length: number, value: Buffer, nextOffset: number }}
 */
function parseDerTlvAt(der, offset) {
	if (offset >= der.length) {
		throw new Error('Offset out of bounds');
	}
	const tag = der[offset];
	const lenByte = der[offset + 1];
	let length;
	let headerLen = 2;
	if ((lenByte & 0x80) === 0) {
		length = lenByte;
	} else {
		const numLenBytes = lenByte & 0x7f;
		length = 0;
		for (let i = 0; i < numLenBytes; i++) {
			length = (length << 8) | der[offset + 2 + i];
		}
		headerLen = 2 + numLenBytes;
	}
	const value = der.slice(offset + headerLen, offset + headerLen + length);
	return { tag, length, value, nextOffset: offset + headerLen + length };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
	// Hashing
	computeDocumentHash,
	verifyDocumentHash,
	computeChainHash,
	computeEventHash,

	// PKCS#7 signature
	createPKCS7DetachedSignature,
	verifyPKCS7DetachedSignature,

	// Certificate / key helpers
	pemToDer,
	derToPem,
	generateTestKeyPair,
	validateCertificateChain,

	// OID constants (for advanced use)
	OID,
};
