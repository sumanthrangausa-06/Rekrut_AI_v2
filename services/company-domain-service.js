/**
 * Company Domain Service
 *
 * Handles company domain extraction, lookup, and enforcement
 * for recruiter registration workflows.
 */

const pool = require('../lib/db');
const { normalizeDomain } = require('./email-domain-validator');

/**
 * Find a company by its verified domain.
 * @param {string} domain
 * @returns {Promise<object|null>}
 */
async function findCompanyByDomain(domain) {
  if (!domain) return null;

  const normalized = normalizeDomain(domain);

  // Search by verified_domain first (new strict column)
  let result = await pool.query(
    'SELECT * FROM companies WHERE verified_domain = $1 OR verified_domain = $2 LIMIT 1',
    [domain, normalized],
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  // Fallback to email_domain for backward compatibility
  result = await pool.query(
    'SELECT * FROM companies WHERE email_domain = $1 OR email_domain = $2 LIMIT 1',
    [domain, normalized],
  );

  if (result.rows.length > 0) {
    return result.rows[0];
  }

  return null;
}

/**
 * Check if a domain already has an associated company.
 * @param {string} domain
 * @returns {Promise<boolean>}
 */
async function isDomainTaken(domain) {
  const company = await findCompanyByDomain(domain);
  return company !== null;
}

/**
 * Store a verified domain on a company record.
 * @param {number} companyId
 * @param {string} domain
 * @returns {Promise<void>}
 */
async function storeVerifiedDomain(companyId, domain) {
  if (!companyId || !domain) return;

  const normalized = normalizeDomain(domain);

  await pool.query(
    `UPDATE companies
     SET verified_domain = $1,
         email_domain = COALESCE(email_domain, $1),
         is_verified = true,
         verified_at = COALESCE(verified_at, NOW()),
         updated_at = NOW()
     WHERE id = $2`,
    [normalized, companyId],
  );
}

/**
 * Check if an email domain matches a company's verified domain.
 * @param {string} email
 * @param {string} companyDomain
 * @returns {boolean}
 */
function checkDomainMatch(email, companyDomain) {
  if (!email || !companyDomain) return false;

  const parts = email.trim().toLowerCase().split('@');
  if (parts.length !== 2) return false;

  const emailDomain = normalizeDomain(parts[1]);
  const verifiedDomain = normalizeDomain(companyDomain);

  return emailDomain === verifiedDomain;
}

/**
 * Get the company domain from a company record.
 * Prefers verified_domain, falls back to email_domain.
 * @param {object} company
 * @returns {string|null}
 */
function getCompanyDomain(company) {
  if (!company) return null;
  return company.verified_domain || company.email_domain || null;
}

/**
 * Create a pending join request for a recruiter wanting to join an existing company.
 * @param {number} userId
 * @param {number} companyId
 * @param {string} email
 * @param {string} domain
 * @returns {Promise<object>}
 */
async function createJoinRequest(userId, companyId, email, domain) {
  const result = await pool.query(
    `INSERT INTO recruiter_join_requests
     (user_id, company_id, email, domain, status, requested_at)
     VALUES ($1, $2, $3, $4, 'pending', NOW())
     RETURNING *`,
    [userId, companyId, email, normalizeDomain(domain)],
  );
  return result.rows[0];
}

/**
 * Find a pending join request for a user.
 * @param {number} userId
 * @returns {Promise<object|null>}
 */
async function findPendingJoinRequest(userId) {
  const result = await pool.query(
    `SELECT * FROM recruiter_join_requests
     WHERE user_id = $1 AND status = 'pending'
     ORDER BY requested_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] || null;
}

/**
 * Approve a join request.
 * @param {number} requestId
 * @param {number} approvedByUserId
 * @returns {Promise<object|null>}
 */
async function approveJoinRequest(requestId, approvedByUserId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get the request
    const requestResult = await client.query(
      'SELECT * FROM recruiter_join_requests WHERE id = $1',
      [requestId],
    );

    if (requestResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return null;
    }

    // Update request status
    await client.query(
      `UPDATE recruiter_join_requests
       SET status = 'approved',
           approved_at = NOW(),
           approved_by = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [approvedByUserId, requestId],
    );

    // Update user with company_id
    await client.query(
      'UPDATE users SET company_id = $1, updated_at = NOW() WHERE id = $2',
      [request.company_id, request.user_id],
    );

    await client.query('COMMIT');

    return { ...request, status: 'approved' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Reject a join request.
 * @param {number} requestId
 * @param {number} rejectedByUserId
 * @param {string} reason
 * @returns {Promise<object|null>}
 */
async function rejectJoinRequest(requestId, rejectedByUserId, reason = '') {
  const result = await pool.query(
    `UPDATE recruiter_join_requests
     SET status = 'rejected',
         rejected_at = NOW(),
         rejected_by = $1,
         rejection_reason = $2,
         updated_at = NOW()
     WHERE id = $3 AND status = 'pending'
     RETURNING *`,
    [rejectedByUserId, reason, requestId],
  );

  return result.rows[0] || null;
}

/**
 * List pending join requests for a company.
 * @param {number} companyId
 * @returns {Promise<Array>}
 */
async function listPendingJoinRequests(companyId) {
  const result = await pool.query(
    `SELECT rjr.*, u.name as user_name
     FROM recruiter_join_requests rjr
     JOIN users u ON rjr.user_id = u.id
     WHERE rjr.company_id = $1 AND rjr.status = 'pending'
     ORDER BY rjr.requested_at DESC`,
    [companyId],
  );
  return result.rows;
}

/**
 * Get join request by ID.
 * @param {number} requestId
 * @returns {Promise<object|null>}
 */
async function getJoinRequestById(requestId) {
  const result = await pool.query(
    `SELECT rjr.*, u.name as user_name, u.email as user_email
     FROM recruiter_join_requests rjr
     JOIN users u ON rjr.user_id = u.id
     WHERE rjr.id = $1`,
    [requestId],
  );
  return result.rows[0] || null;
}

module.exports = {
  findCompanyByDomain,
  isDomainTaken,
  storeVerifiedDomain,
  checkDomainMatch,
  getCompanyDomain,
  createJoinRequest,
  findPendingJoinRequest,
  approveJoinRequest,
  rejectJoinRequest,
  listPendingJoinRequests,
  getJoinRequestById,
};
