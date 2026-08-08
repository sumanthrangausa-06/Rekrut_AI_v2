/**
 * Migration: E-Signature Engine Foundation (#131)
 *
 * Creates the database schema for digital signature documents, signing parties,
 * signature requests, immutable audit trail, and tamper-detection hash records.
 *
 * Architecture Decisions:
 * - All audit events are append-only (no UPDATE/DELETE allowed conceptually).
 * - document_hash_records uses a simple chain-of-hashes (previous_hash field)
 *   for tamper detection without requiring a full Merkle tree.
 * - signature_documents stores a canonical SHA-256 hash at creation time
 *   to detect any later modification of the document bytes.
 */
module.exports = {
	name: '066_e_signature_engine',
	up: async (client) => {
		// ── 1. Signature Documents ──────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS signature_documents (
				id SERIAL PRIMARY KEY,

				-- Ownership & context
				company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
				created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,

				-- Document metadata
				title VARCHAR(500) NOT NULL,
				description TEXT,
				document_type VARCHAR(100) NOT NULL DEFAULT 'generic',
				-- Types: offer_letter, employment_contract, nda, onboarding_doc,
				--        compliance_form, tax_form, generic

				-- Document storage
				file_url TEXT,
				file_size INTEGER,
				mime_type VARCHAR(100),
				original_filename VARCHAR(255),

				-- Hash at time of upload (tamper baseline)
				document_hash VARCHAR(64) NOT NULL,

				-- Signature configuration
				signature_type VARCHAR(50) NOT NULL DEFAULT 'simple',
				-- Types: simple (click-to-sign), pkcs7_detached, typed_name,
				--        drawn_signature, otp_verified

				-- Status lifecycle
				status VARCHAR(50) NOT NULL DEFAULT 'draft',
				-- Statuses: draft -> sent -> in_progress -> completed -> expired
				--            |-> cancelled

				-- Expiration
				expires_at TIMESTAMP,
				completed_at TIMESTAMP,
				cancelled_at TIMESTAMP,
				cancellation_reason TEXT,

				-- Legal / compliance
				legal_jurisdiction VARCHAR(100) DEFAULT 'US',
				compliance_framework VARCHAR(100),
				-- e.g. "ESIGN", "UETA", "GDPR", "21 CFR Part 11"

				-- Metadata
				metadata JSONB DEFAULT '{}',

				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW()
			)
		`);

		// ── 2. Signing Parties ──────────────────────────────────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS signing_parties (
				id SERIAL PRIMARY KEY,

				-- Link to user (optional — allows external signers)
				user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,

				-- Contact info (required, even for registered users)
				email VARCHAR(255) NOT NULL,
				full_name VARCHAR(255) NOT NULL,
				phone VARCHAR(50),

				-- Organization context
				company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
				job_title VARCHAR(255),

				-- Party role
				party_role VARCHAR(50) NOT NULL DEFAULT 'signer',
				-- Roles: signer, witness, notary, approver, reviewer

				-- Authentication requirements
				auth_method VARCHAR(50) DEFAULT 'email_link',
				-- Methods: email_link, sms_otp, id_verification, sso, none

				-- Party metadata (e.g. government ID verified)
				metadata JSONB DEFAULT '{}',

				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW()
			)
		`);

		// ── 3. Signature Requests (join table with ordering) ────────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS signature_requests (
				id SERIAL PRIMARY KEY,

				document_id INTEGER NOT NULL REFERENCES signature_documents(id) ON DELETE CASCADE,
				party_id INTEGER NOT NULL REFERENCES signing_parties(id) ON DELETE CASCADE,

				-- Signing order (0 = first, sequential by default)
				signing_order INTEGER NOT NULL DEFAULT 0,

				-- Status per party
				status VARCHAR(50) NOT NULL DEFAULT 'pending',
				-- Statuses: pending -> sent -> viewed -> signing -> signed -> declined

				-- Timestamps
				sent_at TIMESTAMP,
				viewed_at TIMESTAMP,
				signed_at TIMESTAMP,
				declined_at TIMESTAMP,
				decline_reason TEXT,

				-- Signature data
				signature_value TEXT,
				-- Base64-encoded PKCS#7 detached signature or simple signature blob

				signature_hash VARCHAR(64),
				-- SHA-256 of the signature value for integrity verification

				signed_document_hash VARCHAR(64),
				-- Hash of the document at time of signing (post-signature snapshot)

				-- Signature metadata
				signature_metadata JSONB DEFAULT '{}',
				-- { ip_address, user_agent, geo_location, device_fingerprint }

				-- Reminder tracking
				reminder_count INTEGER NOT NULL DEFAULT 0,
				last_reminder_at TIMESTAMP,

				created_at TIMESTAMP DEFAULT NOW(),
				updated_at TIMESTAMP DEFAULT NOW(),

				UNIQUE(document_id, party_id)
			)
		`);

		// ── 4. Signature Audit Events (append-only, immutable) ──────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS signature_audit_events (
				id SERIAL PRIMARY KEY,

				-- Context
				document_id INTEGER NOT NULL REFERENCES signature_documents(id) ON DELETE CASCADE,
				request_id INTEGER REFERENCES signature_requests(id) ON DELETE CASCADE,
				party_id INTEGER REFERENCES signing_parties(id) ON DELETE SET NULL,

				-- Event classification
				event_type VARCHAR(100) NOT NULL,
				-- Types:
				--   document_created, document_updated, document_cancelled, document_expired,
				--   party_invited, party_reminded,
				--   document_viewed, signing_started, signed, declined,
				--   hash_verified, tamper_detected,
				--   audit_exported

				-- Event severity
				severity VARCHAR(20) NOT NULL DEFAULT 'info',
				-- Severities: info, warning, error, critical

				-- Event details
				event_data JSONB NOT NULL DEFAULT '{}',
				-- Structured event payload depending on event_type

				-- Verification
				verified_hash VARCHAR(64),
				-- Hash of the event_data JSON at time of creation

				-- Actor identification
				actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
				actor_email VARCHAR(255),
				actor_role VARCHAR(50),

				-- Request context
				ip_address VARCHAR(50),
				user_agent TEXT,
				geo_location VARCHAR(100),

				-- Sequence number for ordering (per document)
				sequence_number INTEGER NOT NULL,

				-- Chain of custody: hash of (prev_hash + this event data)
				previous_hash VARCHAR(64),
				chain_hash VARCHAR(64) NOT NULL,

				created_at TIMESTAMP DEFAULT NOW()
			)
		`);

		// ── 5. Document Hash Records (tamper detection chain) ───────────────
		await client.query(`
			CREATE TABLE IF NOT EXISTS document_hash_records (
				id SERIAL PRIMARY KEY,

				document_id INTEGER NOT NULL REFERENCES signature_documents(id) ON DELETE CASCADE,
				request_id INTEGER REFERENCES signature_requests(id) ON DELETE CASCADE,

				-- Hash type
				hash_type VARCHAR(50) NOT NULL DEFAULT 'sha256',
				-- Types: sha256, sha384, sha512, blake2b

				-- The hash value
				hash_value VARCHAR(128) NOT NULL,

				-- What is being hashed
				hash_scope VARCHAR(50) NOT NULL DEFAULT 'document_content',
				-- Scopes: document_content, document_plus_metadata, signed_document,
				--          signature_value, audit_chain

				-- Previous hash in the chain (null for first record)
				previous_hash VARCHAR(128),

				-- Chain integrity hash = hash(previous_hash + hash_value + timestamp)
				chain_hash VARCHAR(128) NOT NULL,

				-- Verification status
				verified BOOLEAN DEFAULT false,
				verified_at TIMESTAMP,
				verification_method VARCHAR(50),

				-- Actor
				created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,

				created_at TIMESTAMP DEFAULT NOW()
			)
		`);

		// ── 6. Indexes ──────────────────────────────────────────────────────
		await client.query(`
			CREATE INDEX IF NOT EXISTS idx_sig_docs_company
			ON signature_documents(company_id, status);

			CREATE INDEX IF NOT EXISTS idx_sig_docs_created_by
			ON signature_documents(created_by);

			CREATE INDEX IF NOT EXISTS idx_sig_docs_status
			ON signature_documents(status);

			CREATE INDEX IF NOT EXISTS idx_sig_docs_expires
			ON signature_documents(expires_at)
			WHERE status IN ('sent', 'in_progress');

			CREATE INDEX IF NOT EXISTS idx_signing_parties_user
			ON signing_parties(user_id);

			CREATE INDEX IF NOT EXISTS idx_signing_parties_email
			ON signing_parties(email);

			CREATE INDEX IF NOT EXISTS idx_sig_requests_document
			ON signature_requests(document_id, signing_order);

			CREATE INDEX IF NOT EXISTS idx_sig_requests_party
			ON signature_requests(party_id);

			CREATE INDEX IF NOT EXISTS idx_sig_requests_status
			ON signature_requests(status);

			CREATE INDEX IF NOT EXISTS idx_audit_events_document
			ON signature_audit_events(document_id, sequence_number);

			CREATE INDEX IF NOT EXISTS idx_audit_events_type
			ON signature_audit_events(event_type, created_at);

			CREATE INDEX IF NOT EXISTS idx_audit_events_chain
			ON signature_audit_events(chain_hash);

			CREATE INDEX IF NOT EXISTS idx_hash_records_document
			ON document_hash_records(document_id, created_at);

			CREATE INDEX IF NOT EXISTS idx_hash_records_chain
			ON document_hash_records(chain_hash);
		`);

		// ── 7. Updated-at trigger for mutable tables ────────────────────────
		await client.query(`
			CREATE OR REPLACE FUNCTION update_signature_timestamp()
			RETURNS TRIGGER AS $$
			BEGIN
				NEW.updated_at = NOW();
				RETURN NEW;
			END;
			$$ LANGUAGE plpgsql;
		`);

		await client.query(`
			DROP TRIGGER IF EXISTS trigger_sig_docs_updated
			ON signature_documents;
			CREATE TRIGGER trigger_sig_docs_updated
			BEFORE UPDATE ON signature_documents
			FOR EACH ROW
			EXECUTE FUNCTION update_signature_timestamp();
		`);

		await client.query(`
			DROP TRIGGER IF EXISTS trigger_signing_parties_updated
			ON signing_parties;
			CREATE TRIGGER trigger_signing_parties_updated
			BEFORE UPDATE ON signing_parties
			FOR EACH ROW
			EXECUTE FUNCTION update_signature_timestamp();
		`);

		await client.query(`
			DROP TRIGGER IF EXISTS trigger_sig_requests_updated
			ON signature_requests;
			CREATE TRIGGER trigger_sig_requests_updated
			BEFORE UPDATE ON signature_requests
			FOR EACH ROW
			EXECUTE FUNCTION update_signature_timestamp();
		`);

		console.log('[migration] E-Signature Engine tables created');
	},
};
