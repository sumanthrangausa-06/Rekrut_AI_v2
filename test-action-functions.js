#!/usr/bin/env node
/**
 * Comprehensive Action Function Test Suite
 * Tests all recruiter and candidate action buttons/functions
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m'
};

let testResults = {
  passed: 0,
  failed: 0,
  errors: []
};

let recruiterToken = null;
let candidateToken = null;
let testJobId = null;
let testApplicationId = null;
let testOfferId = null;
let testAssessmentSession = null;

// Helper functions
function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function pass(test) {
  testResults.passed++;
  log(`✓ ${test}`, 'green');
}

function fail(test, error) {
  testResults.failed++;
  testResults.errors.push({ test, error });
  log(`✗ ${test}: ${error}`, 'red');
}

async function makeRequest(method, path, body = null, token = null) {
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json'
    }
  };

  if (token) {
    options.headers['Authorization'] = `Bearer ${token}`;
  }

  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.json();

  return { status: response.status, data };
}

// ============================================
// Test Setup: Create test users
// ============================================
async function setup() {
  log('\n=== SETUP: Creating test users ===', 'cyan');

  // Create recruiter user
  try {
    const recruiterRes = await makeRequest('POST', '/api/auth/register', {
      name: 'Test Recruiter',
      email: `recruiter-${Date.now()}@test.com`,
      password: 'test123',
      role: 'recruiter',
      company_name: 'Test Company'
    });

    if (recruiterRes.status === 200 || recruiterRes.status === 201) {
      recruiterToken = recruiterRes.data.token;
      pass('Created recruiter user');
    } else {
      fail('Create recruiter user', recruiterRes.data.error);
    }
  } catch (err) {
    fail('Create recruiter user', err.message);
  }

  // Create candidate user
  try {
    const candidateRes = await makeRequest('POST', '/api/auth/register', {
      name: 'Test Candidate',
      email: `candidate-${Date.now()}@test.com`,
      password: 'test123',
      role: 'candidate'
    });

    if (candidateRes.status === 200 || candidateRes.status === 201) {
      candidateToken = candidateRes.data.token;
      pass('Created candidate user');
    } else {
      fail('Create candidate user', candidateRes.data.error);
    }
  } catch (err) {
    fail('Create candidate user', err.message);
  }
}

// ============================================
// RECRUITER SIDE TESTS
// ============================================
async function testRecruiterPostJob() {
  log('\n=== TEST: Recruiter - Post Job ===', 'cyan');

  try {
    const res = await makeRequest('POST', '/api/recruiter/jobs', {
      title: 'Software Engineer',
      description: 'Build amazing things',
      requirements: 'JavaScript, Node.js',
      location: 'Remote',
      salary_range: '$100k-$150k',
      job_type: 'full-time'
    }, recruiterToken);

    if (res.status === 200 && res.data.success) {
      testJobId = res.data.job.id;
      pass('Recruiter can post job');

      // Verify job appears in job listing
      const listRes = await makeRequest('GET', '/api/jobs', null, null);
      const jobExists = listRes.data.jobs.some(j => j.id === testJobId);

      if (jobExists) {
        pass('Job appears in public job listing');
      } else {
        fail('Job appears in public job listing', 'Job not found in listing');
      }
    } else {
      fail('Recruiter can post job', res.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Recruiter can post job', err.message);
  }
}

async function testCandidateApplyToJob() {
  log('\n=== TEST: Candidate - Apply to Job ===', 'cyan');

  if (!testJobId) {
    fail('Candidate can apply to job', 'No test job available');
    return;
  }

  try {
    const res = await makeRequest('POST', `/api/candidate/jobs/${testJobId}/apply`, {
      cover_letter: 'I am very interested in this position'
    }, candidateToken);

    if (res.status === 200 && res.data.success) {
      testApplicationId = res.data.application.id;
      pass('Candidate can apply to job');

      // Verify application appears in recruiter dashboard
      const recruiterApps = await makeRequest('GET', '/api/recruiter/applications', null, recruiterToken);
      const appExists = recruiterApps.data.applications?.some(a => a.id === testApplicationId);

      if (appExists) {
        pass('Application appears in recruiter dashboard');
      } else {
        fail('Application appears in recruiter dashboard', 'Application not found');
      }
    } else {
      fail('Candidate can apply to job', res.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Candidate can apply to job', err.message);
  }
}

async function testRecruiterReviewApplication() {
  log('\n=== TEST: Recruiter - Review/Approve Application ===', 'cyan');

  if (!testApplicationId) {
    fail('Recruiter can approve application', 'No test application available');
    return;
  }

  try {
    // Test approval
    const approveRes = await makeRequest('PUT', `/api/recruiter/applications/${testApplicationId}`, {
      status: 'reviewing',
      recruiter_notes: 'Good candidate'
    }, recruiterToken);

    if (approveRes.status === 200 && approveRes.data.success) {
      pass('Recruiter can update application status');
    } else {
      fail('Recruiter can update application status', approveRes.data.error || 'Unknown error');
    }

    // Test rejection
    const rejectRes = await makeRequest('PUT', `/api/recruiter/applications/${testApplicationId}`, {
      status: 'rejected',
      recruiter_notes: 'Not a good fit'
    }, recruiterToken);

    if (rejectRes.status === 200 && rejectRes.data.success) {
      pass('Recruiter can reject application');
    } else {
      fail('Recruiter can reject application', rejectRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Recruiter review application', err.message);
  }
}

async function testRecruiterSendOffer() {
  log('\n=== TEST: Recruiter - Send Offer ===', 'cyan');

  if (!testJobId || !testApplicationId) {
    fail('Recruiter can send offer', 'Missing test data');
    return;
  }

  try {
    // First, get candidate ID from application
    const appRes = await makeRequest('GET', '/api/recruiter/applications', null, recruiterToken);
    const app = appRes.data.applications?.find(a => a.id === testApplicationId);

    if (!app) {
      fail('Recruiter can send offer', 'Application not found');
      return;
    }

    // Create offer
    const createRes = await makeRequest('POST', '/api/onboarding/offers', {
      candidate_id: app.candidate_id,
      job_id: testJobId,
      title: 'Software Engineer',
      salary: 120000,
      start_date: '2024-01-01',
      benefits: 'Health insurance, 401k'
    }, recruiterToken);

    if (createRes.status === 200 && createRes.data.id) {
      testOfferId = createRes.data.id;
      pass('Recruiter can create offer');

      // Send offer
      const sendRes = await makeRequest('POST', `/api/onboarding/offers/${testOfferId}/send`, {}, recruiterToken);

      if (sendRes.status === 200) {
        pass('Recruiter can send offer');

        // Verify offer appears in candidate dashboard
        const candidateOffers = await makeRequest('GET', '/api/onboarding/offers/me', null, candidateToken);
        const offerExists = candidateOffers.data?.some(o => o.id === testOfferId);

        if (offerExists) {
          pass('Offer appears in candidate dashboard');
        } else {
          fail('Offer appears in candidate dashboard', 'Offer not found');
        }
      } else {
        fail('Recruiter can send offer', sendRes.data.error || 'Unknown error');
      }
    } else {
      fail('Recruiter can create offer', createRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Recruiter send offer', err.message);
  }
}

async function testCandidateOfferActions() {
  log('\n=== TEST: Candidate - View/Accept/Reject Offers ===', 'cyan');

  if (!testOfferId) {
    fail('Candidate offer actions', 'No test offer available');
    return;
  }

  try {
    // View offer
    const viewRes = await makeRequest('POST', `/api/onboarding/offers/${testOfferId}/view`, {}, candidateToken);
    if (viewRes.status === 200) {
      pass('Candidate can view offer');
    } else {
      fail('Candidate can view offer', viewRes.data.error || 'Unknown error');
    }

    // Accept offer
    const acceptRes = await makeRequest('POST', `/api/onboarding/offers/${testOfferId}/accept`, {
      signature_url: 'https://example.com/signature.png'
    }, candidateToken);

    if (acceptRes.status === 200) {
      pass('Candidate can accept offer');

      // Verify offer status updated for recruiter
      const recruiterOffers = await makeRequest('GET', '/api/onboarding/offers', null, recruiterToken);
      const offer = recruiterOffers.data?.find(o => o.id === testOfferId);

      if (offer && offer.status === 'accepted') {
        pass('Offer acceptance reflected in recruiter dashboard');
      } else {
        fail('Offer acceptance reflected in recruiter dashboard', `Status: ${offer?.status}`);
      }
    } else {
      fail('Candidate can accept offer', acceptRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Candidate offer actions', err.message);
  }
}

async function testPayrollActions() {
  log('\n=== TEST: Payroll Dashboard Actions ===', 'cyan');

  try {
    // Get payroll dashboard
    const dashRes = await makeRequest('GET', '/api/payroll/dashboard', null, recruiterToken);

    if (dashRes.status === 200 || dashRes.status === 403) {
      // Note: May fail if user doesn't have employer role
      if (dashRes.status === 200) {
        pass('Payroll dashboard loads');
      } else {
        log('⚠ Payroll dashboard requires employer role (expected)', 'yellow');
      }
    } else {
      fail('Payroll dashboard loads', dashRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Payroll dashboard', err.message);
  }
}

async function testAssessmentActions() {
  log('\n=== TEST: Assessment Actions ===', 'cyan');

  try {
    // Candidate: Add a skill first
    const skillRes = await makeRequest('POST', '/api/candidate/skills', {
      skill_name: 'JavaScript',
      category: 'technical',
      level: 3
    }, candidateToken);

    if (skillRes.status === 200 && skillRes.data.success) {
      const skillId = skillRes.data.skill.id;
      pass('Candidate can add skill');

      // Start assessment
      const startRes = await makeRequest('POST', '/api/assessments/start', {
        skillId: skillId
      }, candidateToken);

      if (startRes.status === 200 && startRes.data.sessionId) {
        testAssessmentSession = startRes.data.sessionId;
        pass('Candidate can start assessment');
      } else {
        fail('Candidate can start assessment', startRes.data.error || 'Unknown error');
      }
    } else {
      fail('Candidate add skill', skillRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Assessment actions', err.message);
  }
}

async function testCandidateProfileUpdate() {
  log('\n=== TEST: Candidate - Profile Updates ===', 'cyan');

  try {
    const updateRes = await makeRequest('PUT', '/api/candidate/profile', {
      headline: 'Senior Software Engineer',
      bio: 'Passionate about building great products',
      location: 'San Francisco, CA'
    }, candidateToken);

    if (updateRes.status === 200 && updateRes.data.success) {
      pass('Candidate can update profile');

      // Verify changes persist
      const getRes = await makeRequest('GET', '/api/candidate/profile', null, candidateToken);
      const profile = getRes.data.profile;

      if (profile && profile.headline === 'Senior Software Engineer') {
        pass('Profile changes persist');
      } else {
        fail('Profile changes persist', 'Profile not updated correctly');
      }
    } else {
      fail('Candidate can update profile', updateRes.data.error || 'Unknown error');
    }
  } catch (err) {
    fail('Candidate profile update', err.message);
  }
}

// ============================================
// Run all tests
// ============================================
async function runTests() {
  log('\n🧪 Starting Comprehensive Action Function Test Suite', 'cyan');
  log('================================================\n', 'cyan');

  await setup();

  if (!recruiterToken || !candidateToken) {
    log('\n❌ Setup failed - cannot run tests', 'red');
    return;
  }

  // Recruiter tests
  await testRecruiterPostJob();

  // Candidate tests
  await testCandidateApplyToJob();
  await testCandidateProfileUpdate();

  // Recruiter review tests
  await testRecruiterReviewApplication();
  await testRecruiterSendOffer();

  // Candidate offer tests
  await testCandidateOfferActions();

  // Assessment tests
  await testAssessmentActions();

  // Payroll tests
  await testPayrollActions();

  // Print summary
  log('\n================================================', 'cyan');
  log(`\n📊 Test Results:`, 'cyan');
  log(`   Passed: ${testResults.passed}`, 'green');
  log(`   Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'green');

  if (testResults.errors.length > 0) {
    log('\n❌ Failed Tests:', 'red');
    testResults.errors.forEach(({ test, error }) => {
      log(`   - ${test}: ${error}`, 'red');
    });
  }

  log('\n✅ Test suite complete!\n', 'cyan');

  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(err => {
  log(`\n❌ Fatal error: ${err.message}`, 'red');
  process.exit(1);
});
