/**
 * Migration: Company Domain Enforcement
 * Issue #103 - Enforce company email domain on recruiter registration
 */

module.exports = {
	name: 'company_domain_enforcement',
	up: async (client) => {
		// Add verified_domain column to companies table
		// This is the canonical domain that all recruiters must match
		await client.query(`
      ALTER TABLE companies
      ADD COLUMN IF NOT EXISTS verified_domain TEXT,
      ADD COLUMN IF NOT EXISTS domain_enforced_at TIMESTAMP
    `);

		// Create index on verified_domain for fast lookups
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_companies_verified_domain
      ON companies(verified_domain)
    `);

		// Backfill: set verified_domain from email_domain for existing companies
		// that have email_domain set and are verified
		await client.query(`
      UPDATE companies
      SET verified_domain = email_domain,
          domain_enforced_at = NOW()
      WHERE verified_domain IS NULL
        AND email_domain IS NOT NULL
        AND is_verified = true
    `);

		// Create recruiter_join_requests table for approval workflow
		await client.query(`
      CREATE TABLE IF NOT EXISTS recruiter_join_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        domain VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        requested_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP,
        approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejected_at TIMESTAMP,
        rejected_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, company_id)
      )
    `);

		// Create indexes for join requests
		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_join_requests_company_status
      ON recruiter_join_requests(company_id, status)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_join_requests_user
      ON recruiter_join_requests(user_id)
    `);

		await client.query(`
      CREATE INDEX IF NOT EXISTS idx_join_requests_domain
      ON recruiter_join_requests(domain)
    `);

		console.log('Company domain enforcement migration completed');
	},
};
