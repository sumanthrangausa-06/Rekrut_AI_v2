const OpenAI = require('openai');
const crypto = require('crypto');
const pool = require('../lib/db');

const openai = new OpenAI(); // Uses OPENAI_BASE_URL and OPENAI_API_KEY from env

/**
 * Document Verification Service
 * Handles OCR, fraud detection, authenticity scoring, and consistency checks
 */

// Document type configurations
const DOCUMENT_CONFIGS = {
  resume: {
    required_fields: ['name', 'contact', 'experience'],
    authenticity_weight: 0.7,
    score_impact: 50
  },
  education_certificate: {
    required_fields: ['institution', 'degree', 'date', 'student_name'],
    authenticity_weight: 1.0,
    score_impact: 100
  },
  employment_letter: {
    required_fields: ['company', 'employee_name', 'dates', 'title'],
    authenticity_weight: 0.9,
    score_impact: 80
  },
  id_document: {
    required_fields: ['name', 'id_number', 'photo', 'issue_date'],
    authenticity_weight: 1.0,
    score_impact: 120
  },
  certification: {
    required_fields: ['certification_name', 'issuer', 'date'],
    authenticity_weight: 0.85,
    score_impact: 60
  }
};

/**
 * Process document with OCR and extract text
 */
async function processDocumentOCR(fileUrl, documentType) {
  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Extract all text and structured data from this ${documentType} document. Return JSON with:
            - raw_text: all visible text
            - structured_data: organized fields based on document type
            - dates: all dates found
            - names: all names found
            - companies: all company/organization names found`
          },
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          }
        ]
      }],
      response_format: { type: 'json_object' }
    });

    const result = JSON.parse(response.choices[0].message.content);
    return {
      extracted_text: result.raw_text || '',
      extracted_data: result.structured_data || {},
      metadata: {
        dates: result.dates || [],
        names: result.names || [],
        companies: result.companies || []
      }
    };
  } catch (error) {
    console.error('OCR processing error:', error);
    throw new Error('Failed to process document: ' + error.message);
  }
}

/**
 * Calculate authenticity score for a document
 */
async function calculateAuthenticityScore(extractedData, documentType, fileUrl) {
  try {
    const config = DOCUMENT_CONFIGS[documentType] || DOCUMENT_CONFIGS.resume;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: 'You are an expert document fraud detector. Analyze documents for signs of tampering, forgery, or inauthenticity.'
      }, {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Analyze this ${documentType} for authenticity. Consider:
            - Visual quality and consistency
            - Text alignment and formatting
            - Logos and official marks
            - Dates and signatures
            - Overall professional appearance

            Return JSON with:
            - authenticity_score: 0-100 (100 = highly authentic)
            - fraud_flags: array of suspicious indicators
            - confidence: your confidence level (0-100)
            - reasoning: brief explanation`
          },
          {
            type: 'image_url',
            image_url: { url: fileUrl }
          }
        ]
      }],
      response_format: { type: 'json_object' }
    });

    const analysis = JSON.parse(response.choices[0].message.content);

    return {
      authenticity_score: analysis.authenticity_score || 50,
      fraud_flags: analysis.fraud_flags || [],
      confidence_score: analysis.confidence || 50,
      ai_analysis: analysis
    };
  } catch (error) {
    console.error('Authenticity scoring error:', error);
    return {
      authenticity_score: 50,
      fraud_flags: ['analysis_failed'],
      confidence_score: 0,
      ai_analysis: { error: error.message }
    };
  }
}

/**
 * Check for duplicate documents across candidates
 */
async function checkDuplicateDocument(fileUrl, userId) {
  try {
    // Create hash of document content
    const documentHash = crypto.createHash('sha256').update(fileUrl).digest('hex');

    const result = await pool.query(`
      SELECT dv.*, vd.user_id, vd.file_url
      FROM document_verifications dv
      JOIN verification_documents vd ON dv.document_id = vd.id
      WHERE dv.duplicate_hash = $1 AND vd.user_id != $2
      LIMIT 1
    `, [documentHash, userId]);

    if (result.rows.length > 0) {
      return {
        is_duplicate: true,
        duplicate_of: result.rows[0].document_id,
        original_user: result.rows[0].user_id
      };
    }

    return {
      is_duplicate: false,
      duplicate_hash: documentHash
    };
  } catch (error) {
    console.error('Duplicate check error:', error);
    return { is_duplicate: false, duplicate_hash: null };
  }
}

/**
 * Check consistency with candidate profile
 */
async function checkProfileConsistency(extractedData, userId) {
  try {
    // Get candidate profile data
    const profileResult = await pool.query(`
      SELECT u.name, u.email, cp.*
      FROM users u
      LEFT JOIN candidate_profiles cp ON u.id = cp.user_id
      WHERE u.id = $1
    `, [userId]);

    if (profileResult.rows.length === 0) {
      return { consistency_checks: {}, inconsistencies: [] };
    }

    const profile = profileResult.rows[0];
    const inconsistencies = [];

    // Check name consistency
    const documentNames = extractedData.names || [];
    const profileName = profile.name;
    const nameMatch = documentNames.some(name =>
      name.toLowerCase().includes(profileName?.toLowerCase() || '')
    );

    // Get work experience
    const workExp = await pool.query(`
      SELECT company_name, title, start_date, end_date
      FROM work_experience
      WHERE user_id = $1
      ORDER BY start_date DESC
    `, [userId]);

    // Check employer consistency
    const documentCompanies = extractedData.companies || [];
    const profileCompanies = workExp.rows.map(w => w.company_name);

    const checks = {
      name_consistency_check: nameMatch,
      date_consistency_check: true, // Complex logic - simplified for now
      employer_consistency_check: documentCompanies.some(dc =>
        profileCompanies.some(pc => dc.toLowerCase().includes(pc.toLowerCase()))
      ),
      education_consistency_check: true // Would check against education table
    };

    if (!checks.name_consistency_check) {
      inconsistencies.push({
        type: 'name_mismatch',
        severity: 'high',
        details: 'Document name does not match profile name'
      });
    }

    if (!checks.employer_consistency_check && documentCompanies.length > 0) {
      inconsistencies.push({
        type: 'employer_mismatch',
        severity: 'medium',
        details: 'Document employers not found in profile'
      });
    }

    return {
      consistency_checks: checks,
      inconsistencies
    };
  } catch (error) {
    console.error('Consistency check error:', error);
    return { consistency_checks: {}, inconsistencies: [] };
  }
}

/**
 * Calculate document score impact on OmniScore
 */
function calculateScoreImpact(documentType, authenticityScore, fraudFlags, inconsistencies) {
  const baseImpact = DOCUMENT_CONFIGS[documentType]?.score_impact || 50;

  // Reduce impact based on fraud flags
  let fraudPenalty = fraudFlags.length * 10;

  // Reduce impact based on inconsistencies
  let consistencyPenalty = inconsistencies.filter(i => i.severity === 'high').length * 15 +
                           inconsistencies.filter(i => i.severity === 'medium').length * 5;

  // Score multiplier based on authenticity
  let multiplier = authenticityScore / 100;

  let finalImpact = Math.floor(baseImpact * multiplier - fraudPenalty - consistencyPenalty);

  // Clamp between -50 and max base impact
  return Math.max(-50, Math.min(baseImpact, finalImpact));
}

/**
 * Main function: Verify uploaded document
 */
async function verifyDocument(documentId, userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get document details
    const docResult = await client.query(`
      SELECT * FROM verification_documents WHERE id = $1 AND user_id = $2
    `, [documentId, userId]);

    if (docResult.rows.length === 0) {
      throw new Error('Document not found');
    }

    const document = docResult.rows[0];

    // Step 1: OCR Processing
    console.log(`Processing OCR for document ${documentId}...`);
    const ocrResult = await processDocumentOCR(document.file_url, document.document_type);

    // Step 2: Authenticity Scoring
    console.log(`Calculating authenticity score...`);
    const authenticityResult = await calculateAuthenticityScore(
      ocrResult.extracted_data,
      document.document_type,
      document.file_url
    );

    // Step 3: Duplicate Detection
    console.log(`Checking for duplicates...`);
    const duplicateResult = await checkDuplicateDocument(document.file_url, userId);

    // Step 4: Consistency Checks
    console.log(`Checking profile consistency...`);
    const consistencyResult = await checkProfileConsistency(ocrResult.metadata, userId);

    // Determine fraud risk level
    let fraudRisk = 'low';
    if (authenticityResult.authenticity_score < 40 || duplicateResult.is_duplicate) {
      fraudRisk = 'high';
    } else if (authenticityResult.authenticity_score < 70 || authenticityResult.fraud_flags.length > 2) {
      fraudRisk = 'medium';
    }

    // Update document with OCR results
    await client.query(`
      UPDATE verification_documents
      SET extracted_text = $1,
          extracted_data = $2,
          authenticity_score = $3,
          fraud_flags = $4,
          status = $5,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE id = $6
    `, [
      ocrResult.extracted_text,
      JSON.stringify(ocrResult.extracted_data),
      authenticityResult.authenticity_score,
      JSON.stringify(authenticityResult.fraud_flags),
      fraudRisk === 'high' ? 'flagged' : 'processed',
      documentId
    ]);

    // Create verification record
    const verificationResult = await client.query(`
      INSERT INTO document_verifications (
        document_id, user_id, verification_type,
        authenticity_score, fraud_risk, fraud_indicators,
        date_consistency_check, name_consistency_check,
        employer_consistency_check, education_consistency_check,
        inconsistencies_found, duplicate_hash, is_duplicate, duplicate_of,
        ai_analysis, confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *
    `, [
      documentId,
      userId,
      'automated',
      authenticityResult.authenticity_score,
      fraudRisk,
      JSON.stringify(authenticityResult.fraud_flags),
      consistencyResult.consistency_checks.date_consistency_check || false,
      consistencyResult.consistency_checks.name_consistency_check || false,
      consistencyResult.consistency_checks.employer_consistency_check || false,
      consistencyResult.consistency_checks.education_consistency_check || false,
      JSON.stringify(consistencyResult.inconsistencies),
      duplicateResult.duplicate_hash,
      duplicateResult.is_duplicate,
      duplicateResult.duplicate_of || null,
      JSON.stringify(authenticityResult.ai_analysis),
      authenticityResult.confidence_score
    ]);

    // Calculate score impact
    const scoreImpact = calculateScoreImpact(
      document.document_type,
      authenticityResult.authenticity_score,
      authenticityResult.fraud_flags,
      consistencyResult.inconsistencies
    );

    // Record score impact
    await client.query(`
      INSERT INTO document_score_impacts (
        user_id, document_id, document_type,
        score_impact, authenticity_score, verification_status
      ) VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      userId,
      documentId,
      document.document_type,
      scoreImpact,
      authenticityResult.authenticity_score,
      fraudRisk === 'high' ? 'flagged' : 'verified'
    ]);

    // If document is verified (not flagged), add verified credential
    if (fraudRisk !== 'high' && authenticityResult.authenticity_score >= 70) {
      const credentialName = ocrResult.extracted_data.degree ||
                            ocrResult.extracted_data.certification_name ||
                            document.document_type;

      const issuer = ocrResult.extracted_data.institution ||
                    ocrResult.extracted_data.company ||
                    ocrResult.extracted_data.issuer ||
                    'Unknown';

      await client.query(`
        INSERT INTO verified_credentials (
          user_id, credential_type, credential_name, issuer,
          verification_status, document_id, verification_score
        ) VALUES ($1, $2, $3, $4, 'verified', $5, $6)
        ON CONFLICT (user_id, credential_type, credential_name, issuer) DO UPDATE
        SET verification_score = $6, verified_at = NOW()
      `, [
        userId,
        document.document_type,
        credentialName,
        issuer,
        documentId,
        authenticityResult.authenticity_score
      ]);
    }

    await client.query('COMMIT');

    return {
      success: true,
      verification: verificationResult.rows[0],
      score_impact: scoreImpact,
      fraud_risk: fraudRisk,
      authenticity_score: authenticityResult.authenticity_score
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Document verification error:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Apply verified document scores to OmniScore
 */
async function applyDocumentScoresToOmniScore(userId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Get pending score impacts
    const impacts = await client.query(`
      SELECT * FROM document_score_impacts
      WHERE user_id = $1 AND applied_to_omniscore = false
    `, [userId]);

    if (impacts.rows.length === 0) {
      return { success: true, score_change: 0 };
    }

    const totalImpact = impacts.rows.reduce((sum, imp) => sum + imp.score_impact, 0);

    // Update OmniScore
    const omniscoreResult = await client.query(`
      INSERT INTO omni_scores (user_id, total_score, resume_score)
      VALUES ($1, 300 + $2, $2)
      ON CONFLICT (user_id) DO UPDATE
      SET resume_score = omni_scores.resume_score + $2,
          total_score = omni_scores.total_score + $2,
          last_updated = NOW()
      RETURNING *
    `, [userId, totalImpact]);

    // Mark impacts as applied
    await client.query(`
      UPDATE document_score_impacts
      SET applied_to_omniscore = true, applied_at = NOW()
      WHERE user_id = $1 AND applied_to_omniscore = false
    `, [userId]);

    // Add to score history
    await client.query(`
      INSERT INTO score_history (user_id, change_amount, change_reason, component_type, new_score)
      VALUES ($1, $2, 'Document verification completed', 'document', $3)
    `, [userId, totalImpact, omniscoreResult.rows[0].total_score]);

    await client.query('COMMIT');

    return {
      success: true,
      score_change: totalImpact,
      new_score: omniscoreResult.rows[0].total_score
    };

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error applying document scores:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Log document access for audit trail
 */
async function logDocumentAccess(documentId, accessedBy, accessType, companyId = null, ipAddress = null) {
  try {
    await pool.query(`
      INSERT INTO document_access_logs (
        document_id, accessed_by, access_type, company_id, ip_address, accessed_at
      ) VALUES ($1, $2, $3, $4, $5, NOW())
    `, [documentId, accessedBy, accessType, companyId, ipAddress]);
  } catch (error) {
    console.error('Error logging document access:', error);
  }
}

module.exports = {
  verifyDocument,
  applyDocumentScoresToOmniScore,
  logDocumentAccess,
  processDocumentOCR,
  calculateAuthenticityScore
};
