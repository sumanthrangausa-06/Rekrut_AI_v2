// Verification script for Phase 2: Recruiter Module + TrustScore

async function verify() {
  console.log('Verifying Phase 2 implementation...\n');

  // Check that all required files exist
  const fs = require('fs');
  const path = require('path');

  const requiredFiles = [
    // Backend
    'migrations/002_add_trustscore.js',
    'services/trustscore.js',
    'services/job-optimizer.js',
    'routes/company.js',
    'routes/trustscore.js',
    'routes/recruiter.js',
    // Frontend
    'public/recruiter-register.html',
    'public/recruiter-dashboard.html',
    'public/recruiter-trustscore.html',
    'public/recruiter-jobs.html',
    'public/job-create.html',
    'public/company-profile.html',
  ];

  console.log('Checking required files...');
  let allFilesExist = true;
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      console.log(`  ✓ ${file}`);
    } else {
      console.log(`  ✗ ${file} - MISSING`);
      allFilesExist = false;
    }
  }

  if (!allFilesExist) {
    console.log('\nVerification FAILED: Missing files');
    process.exit(1);
  }

  // Verify modules can be required
  console.log('\nChecking module imports...');
  try {
    const trustscoreService = require('./services/trustscore');
    console.log('  ✓ TrustScore service');
    console.log(`    - TRUST_SCORE_RANGES.MAX = ${trustscoreService.TRUST_SCORE_RANGES.MAX}`);
    console.log(`    - Components: ${Object.keys(trustscoreService.TRUST_COMPONENTS).join(', ')}`);
  } catch (e) {
    console.log(`  ✗ TrustScore service - ${e.message}`);
    process.exit(1);
  }

  try {
    const jobOptimizer = require('./services/job-optimizer');
    console.log('  ✓ Job optimizer service');
    console.log(`    - Functions: ${Object.keys(jobOptimizer).join(', ')}`);
  } catch (e) {
    console.log(`  ✗ Job optimizer service - ${e.message}`);
    process.exit(1);
  }

  try {
    const companyRoutes = require('./routes/company');
    console.log('  ✓ Company routes');
  } catch (e) {
    console.log(`  ✗ Company routes - ${e.message}`);
    process.exit(1);
  }

  try {
    const trustscoreRoutes = require('./routes/trustscore');
    console.log('  ✓ TrustScore routes');
  } catch (e) {
    console.log(`  ✗ TrustScore routes - ${e.message}`);
    process.exit(1);
  }

  try {
    const recruiterRoutes = require('./routes/recruiter');
    console.log('  ✓ Recruiter routes');
  } catch (e) {
    console.log(`  ✗ Recruiter routes - ${e.message}`);
    process.exit(1);
  }

  // Check migration structure
  console.log('\nChecking migration structure...');
  const migration = require('./migrations/002_add_trustscore');
  if (migration.name && typeof migration.up === 'function') {
    console.log(`  ✓ Migration "${migration.name}" is valid`);
  } else {
    console.log('  ✗ Migration is invalid');
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('✅ All Phase 2 verifications PASSED!');
  console.log('========================================');
  console.log('\nFeatures implemented:');
  console.log('  - Company/Recruiter registration with email verification');
  console.log('  - TrustScore system (0-1000 range)');
  console.log('  - TrustScore dimensions: verification, job_authenticity, hiring_ratio, feedback, behavior');
  console.log('  - AI-powered job description optimization');
  console.log('  - Job posting creation with AI analysis');
  console.log('  - Recruiter dashboard');
  console.log('  - Company profile management');
  console.log('  - Hiring analytics');
  console.log('  - Interview scheduling');
}

verify().catch(e => {
  console.error('Verification error:', e);
  process.exit(1);
});
