#!/usr/bin/env node
/**
 * Phase 2 End-to-End QA Script
 * Tests: Jobs, Applications, Skill Tests, Offers
 * Both candidate and recruiter perspectives + bidirectional checks
 */

const BASE_URL = process.env.BASE_URL || 'https://hireloop-vzvw.polsia.app';

// Unique suffix for test data
const TS = Date.now().toString(36);

const CANDIDATE = {
  email: `qa-candidate-${TS}@test.com`,
  password: 'TestPass123!',
  name: `QA Candidate ${TS}`,
};

const RECRUITER = {
  email: `qa-recruiter-${TS}@test.com`,
  password: 'TestPass123!',
  name: `QA Recruiter ${TS}`,
  company_name: `QA Corp ${TS}`,
};

let candidateToken = null;
let recruiterToken = null;
let candidateId = null;
let recruiterId = null;

// Track bugs
const bugs = [];
let passed = 0;
let failed = 0;
let skipped = 0;

function log(icon, msg) {
  console.log(`  ${icon} ${msg}`);
}

function pass(msg) {
  passed++;
  log('✅', msg);
}

function fail(msg, detail = '') {
  failed++;
  const bugEntry = detail ? `${msg}: ${detail}` : msg;
  bugs.push(bugEntry);
  log('❌', bugEntry);
}

function skip(msg) {
  skipped++;
  log('⏭️', msg);
}

async function api(path, options = {}) {
  const { token, method = 'GET', body } = options;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const fetchOpts = { method, headers };
  if (body) fetchOpts.body = JSON.stringify(body);

  try {
    const res = await fetch(`${BASE_URL}/api${path}`, fetchOpts);
    const data = await res.json().catch(() => ({}));
    return { status: res.status, ok: res.ok, data };
  } catch (err) {
    return { status: 0, ok: false, data: { error: err.message } };
  }
}

// ======================================
// AUTH: Register both users
// ======================================
async function setupAuth() {
  console.log('\n🔑 SETUP: Registering test users...');

  // Register candidate
  const candReg = await api('/auth/register', {
    method: 'POST',
    body: { email: CANDIDATE.email, password: CANDIDATE.password, name: CANDIDATE.name, role: 'candidate' }
  });

  if (candReg.ok && (candReg.data.accessToken || candReg.data.token)) {
    candidateToken = candReg.data.accessToken || candReg.data.token;
    candidateId = candReg.data.user?.id;
    pass(`Candidate registered: ${CANDIDATE.email}`);
  } else {
    // Try login
    const candLogin = await api('/auth/login', {
      method: 'POST',
      body: { email: CANDIDATE.email, password: CANDIDATE.password }
    });
    if (candLogin.ok && (candLogin.data.accessToken || candLogin.data.token)) {
      candidateToken = candLogin.data.accessToken || candLogin.data.token;
      candidateId = candLogin.data.user?.id;
      pass(`Candidate logged in: ${CANDIDATE.email}`);
    } else {
      fail('Candidate auth failed', JSON.stringify(candReg.data));
      return false;
    }
  }

  // Register recruiter
  const recReg = await api('/auth/register', {
    method: 'POST',
    body: {
      email: RECRUITER.email,
      password: RECRUITER.password,
      name: RECRUITER.name,
      role: 'employer',
      company_name: RECRUITER.company_name
    }
  });

  if (recReg.ok && (recReg.data.accessToken || recReg.data.token)) {
    recruiterToken = recReg.data.accessToken || recReg.data.token;
    recruiterId = recReg.data.user?.id;
    pass(`Recruiter registered: ${RECRUITER.email}`);
  } else {
    const recLogin = await api('/auth/login', {
      method: 'POST',
      body: { email: RECRUITER.email, password: RECRUITER.password }
    });
    if (recLogin.ok && (recLogin.data.accessToken || recLogin.data.token)) {
      recruiterToken = recLogin.data.accessToken || recLogin.data.token;
      recruiterId = recLogin.data.user?.id;
      pass(`Recruiter logged in: ${RECRUITER.email}`);
    } else {
      fail('Recruiter auth failed', JSON.stringify(recReg.data));
      return false;
    }
  }

  return true;
}

// ======================================
// MODULE 1: JOBS
// ======================================
let testJobId = null;

async function testJobs() {
  console.log('\n📋 MODULE 1: JOBS');

  // --- RECRUITER: Create job ---
  console.log('  [Recruiter Side]');
  const createRes = await api('/recruiter/jobs', {
    token: recruiterToken,
    method: 'POST',
    body: {
      title: `QA Test Engineer - ${TS}`,
      description: 'End-to-end testing position for QA verification.',
      requirements: 'Experience with automated testing, API testing, Selenium/Playwright.',
      location: 'Remote',
      salary_range: '$80,000 - $120,000',
      job_type: 'full-time',
      screening_questions: [
        { id: 'q1', text: 'Years of testing experience?', type: 'text', required: true },
        { id: 'q2', text: 'Have you used Selenium?', type: 'yes_no', required: true }
      ]
    }
  });

  if (createRes.ok && createRes.data.job) {
    testJobId = createRes.data.job.id;
    pass(`Recruiter created job (ID: ${testJobId})`);
  } else {
    fail('Recruiter create job failed', JSON.stringify(createRes.data));
    return;
  }

  // --- RECRUITER: List jobs ---
  const listRes = await api('/recruiter/jobs', { token: recruiterToken });
  if (listRes.ok && listRes.data.jobs) {
    const found = listRes.data.jobs.find(j => j.id === testJobId);
    if (found) {
      pass(`Recruiter sees job in list`);
      // Verify screening questions stored correctly
      const sq = typeof found.screening_questions === 'string'
        ? JSON.parse(found.screening_questions) : found.screening_questions;
      if (Array.isArray(sq) && sq.length === 2) {
        pass(`Screening questions stored correctly (${sq.length})`);
      } else {
        fail('Screening questions not stored', `Got: ${JSON.stringify(sq)}`);
      }
    } else {
      fail('Job not found in recruiter list');
    }
  } else {
    fail('Recruiter list jobs failed', JSON.stringify(listRes.data));
  }

  // --- RECRUITER: Edit job ---
  const editRes = await api(`/recruiter/jobs/${testJobId}`, {
    token: recruiterToken,
    method: 'PUT',
    body: { description: 'Updated description for QA test.' }
  });
  if (editRes.ok && editRes.data.job?.description?.includes('Updated')) {
    pass(`Recruiter edited job`);
  } else {
    fail('Recruiter edit job failed', JSON.stringify(editRes.data));
  }

  // --- CANDIDATE: Browse jobs (public) ---
  console.log('  [Candidate Side]');
  const browseRes = await api('/jobs', { token: candidateToken });
  if (browseRes.ok && browseRes.data.jobs) {
    const found = browseRes.data.jobs.find(j => j.id === testJobId);
    if (found) {
      pass(`Candidate sees job in browse list`);
    } else {
      fail('Job not visible to candidate in browse', `Total jobs: ${browseRes.data.jobs.length}`);
    }
  } else {
    fail('Candidate browse jobs failed', JSON.stringify(browseRes.data));
  }

  // --- CANDIDATE: View job detail ---
  const detailRes = await api(`/jobs/${testJobId}`, { token: candidateToken });
  if (detailRes.ok && detailRes.data.job) {
    pass(`Candidate viewed job detail`);
    // Check screening questions are visible
    const sq = typeof detailRes.data.job.screening_questions === 'string'
      ? JSON.parse(detailRes.data.job.screening_questions) : detailRes.data.job.screening_questions;
    if (Array.isArray(sq) && sq.length > 0) {
      pass(`Screening questions visible in detail`);
    } else {
      fail('Screening questions missing from job detail');
    }
  } else {
    fail('Candidate view job detail failed', JSON.stringify(detailRes.data));
  }

  // --- CANDIDATE: Search/filter jobs ---
  const searchRes = await api('/jobs?status=active', { token: candidateToken });
  if (searchRes.ok && searchRes.data.jobs) {
    pass(`Candidate search/filter works (${searchRes.data.jobs.length} active jobs)`);
  } else {
    fail('Candidate search/filter failed');
  }
}

// ======================================
// MODULE 2: APPLICATIONS
// ======================================
let testApplicationId = null;

async function testApplications() {
  console.log('\n📝 MODULE 2: APPLICATIONS');

  if (!testJobId) {
    skip('Skipping applications - no test job');
    return;
  }

  // --- CANDIDATE: Apply to job with screening answers ---
  console.log('  [Candidate Side]');
  const applyRes = await api(`/candidate/jobs/${testJobId}/apply`, {
    token: candidateToken,
    method: 'POST',
    body: {
      cover_letter: 'I am a QA test candidate applying for this position.',
      screening_answers: { q1: '5 years', q2: 'yes' }
    }
  });

  if (applyRes.ok && applyRes.data.application) {
    testApplicationId = applyRes.data.application.id;
    pass(`Candidate applied to job (Application ID: ${testApplicationId})`);
  } else {
    fail('Candidate apply failed', JSON.stringify(applyRes.data));
    return;
  }

  // --- CANDIDATE: View applications ---
  const myAppsRes = await api('/candidate/applications', { token: candidateToken });
  if (myAppsRes.ok && myAppsRes.data.applications) {
    const found = myAppsRes.data.applications.find(a => a.id === testApplicationId);
    if (found) {
      pass(`Candidate sees application in list`);
      // Check screening answers are accessible
      const sa = typeof found.screening_answers === 'string'
        ? JSON.parse(found.screening_answers) : found.screening_answers;
      if (sa && sa.q1) {
        pass(`Screening answers preserved`);
      } else {
        fail('Screening answers missing from application');
      }
    } else {
      fail('Application not found in candidate list');
    }
  } else {
    fail('Candidate list applications failed', JSON.stringify(myAppsRes.data));
  }

  // --- BIDIRECTIONAL: Recruiter sees the application ---
  console.log('  [Recruiter Side]');
  const recAppsRes = await api('/recruiter/applications', { token: recruiterToken });
  if (recAppsRes.ok && recAppsRes.data.applications) {
    const found = recAppsRes.data.applications.find(a => a.id === testApplicationId);
    if (found) {
      pass(`✨ BIDIRECTIONAL: Recruiter sees candidate's application`);
      // Verify candidate info
      if (found.candidate_name) {
        pass(`Application shows candidate name: ${found.candidate_name}`);
      } else {
        fail('Application missing candidate name');
      }
    } else {
      fail('BIDIRECTIONAL FAIL: Recruiter cannot see candidate application',
           `Total: ${recAppsRes.data.applications.length}`);
    }
  } else {
    fail('Recruiter list applications failed', JSON.stringify(recAppsRes.data));
  }

  // --- RECRUITER: View job applicants ---
  const applicantsRes = await api(`/recruiter/jobs/${testJobId}/applications`, { token: recruiterToken });
  if (applicantsRes.ok && applicantsRes.data.applications) {
    const found = applicantsRes.data.applications.find(a => a.id === testApplicationId);
    if (found) {
      pass(`Recruiter sees applicant in job applicants view`);
    } else {
      fail('Applicant not found in job applicants view');
    }
  } else {
    fail('Recruiter job applicants failed', JSON.stringify(applicantsRes.data));
  }

  // --- RECRUITER: Change application status ---
  const statusRes = await api(`/recruiter/applications/${testApplicationId}`, {
    token: recruiterToken,
    method: 'PUT',
    body: { status: 'reviewing', recruiter_notes: 'Looks promising, reviewing further.' }
  });
  if (statusRes.ok && statusRes.data.application?.status === 'reviewing') {
    pass(`Recruiter changed status to "reviewing"`);
  } else {
    fail('Recruiter change status failed', JSON.stringify(statusRes.data));
  }

  // --- BIDIRECTIONAL: Candidate sees updated status ---
  const candAppsAfter = await api('/candidate/applications', { token: candidateToken });
  if (candAppsAfter.ok && candAppsAfter.data.applications) {
    const found = candAppsAfter.data.applications.find(a => a.id === testApplicationId);
    if (found && found.status === 'reviewing') {
      pass(`✨ BIDIRECTIONAL: Candidate sees updated status "reviewing"`);
    } else {
      fail('BIDIRECTIONAL FAIL: Candidate does not see updated status',
           `Got status: ${found?.status}`);
    }
  }

  // --- CANDIDATE: Withdraw application ---
  const withdrawRes = await api(`/candidate/applications/${testApplicationId}/withdraw`, {
    token: candidateToken,
    method: 'PUT',
    body: { reason: 'Testing withdrawal' }
  });
  if (withdrawRes.ok && withdrawRes.data.application?.status === 'withdrawn') {
    pass(`Candidate withdrew application`);
  } else {
    fail('Candidate withdraw failed', JSON.stringify(withdrawRes.data));
  }

  // --- Re-apply for offer testing later ---
  const reapplyRes = await api(`/candidate/jobs/${testJobId}/apply`, {
    token: candidateToken,
    method: 'POST',
    body: {
      cover_letter: 'Re-applying after withdrawal test.',
      screening_answers: { q1: '5 years', q2: 'yes' }
    }
  });
  if (reapplyRes.ok && reapplyRes.data.application) {
    testApplicationId = reapplyRes.data.application.id;
    pass(`Candidate re-applied (Application ID: ${testApplicationId})`);
  }
}

// ======================================
// MODULE 3: SKILL TESTS / ASSESSMENTS
// ======================================
let testSessionId = null;

async function testSkillTests() {
  console.log('\n🧪 MODULE 3: SKILL TESTS');

  // --- CANDIDATE: View skill catalog ---
  console.log('  [Candidate Side]');
  const catalogRes = await api('/assessments/available', { token: candidateToken });
  if (catalogRes.ok && catalogRes.data.skills) {
    const skills = catalogRes.data.skills;
    if (skills.length > 0) {
      pass(`Candidate sees skill catalog (${skills.length} skills)`);
      // Verify catalog structure
      const first = skills[0];
      if (first.catalog_name && first.category && first.icon) {
        pass(`Skill catalog entries have correct structure`);
      } else {
        fail('Skill catalog entry missing fields', JSON.stringify(first));
      }
    } else {
      fail('Skill catalog is empty');
    }
  } else {
    fail('Candidate fetch skill catalog failed', JSON.stringify(catalogRes.data));
    return;
  }

  // --- CANDIDATE: Start assessment ---
  const startRes = await api('/assessments/start', {
    token: candidateToken,
    method: 'POST',
    body: { skillName: 'JavaScript', category: 'technical' }
  });

  if (startRes.ok && startRes.data.sessionId) {
    testSessionId = startRes.data.sessionId;
    pass(`Candidate started JavaScript assessment (Session: ${testSessionId})`);

    // Verify first question
    if (startRes.data.question) {
      const q = startRes.data.question;
      if (q.id && q.text && q.questionNumber === 1 && q.totalQuestions === 10) {
        pass(`First question delivered correctly (Q${q.questionNumber}/${q.totalQuestions})`);
      } else {
        fail('First question has wrong structure', JSON.stringify(q));
      }
    } else {
      fail('No question returned with start');
    }
  } else {
    fail('Candidate start assessment failed', JSON.stringify(startRes.data));
    return;
  }

  // --- CANDIDATE: Answer questions (complete all 10) ---
  let currentQuestion = startRes.data.question;
  let questionsAnswered = 0;
  let lastResponse = null;

  for (let i = 0; i < 10 && currentQuestion; i++) {
    // Pick answer based on question type
    let answer;
    if (currentQuestion.type === 'multiple_choice' && currentQuestion.options) {
      const opts = typeof currentQuestion.options === 'string'
        ? JSON.parse(currentQuestion.options) : currentQuestion.options;
      answer = Array.isArray(opts) && opts.length > 0 ? opts[0] : 'A';
    } else {
      answer = 'This is a test answer for the short answer question about the topic.';
    }

    const answerRes = await api('/assessments/answer', {
      token: candidateToken,
      method: 'POST',
      body: {
        sessionId: testSessionId,
        questionId: currentQuestion.id,
        answer: answer,
        timeTaken: 30
      }
    });

    if (answerRes.ok) {
      questionsAnswered++;
      lastResponse = answerRes.data;

      if (answerRes.data.completed) {
        break;
      }

      if (answerRes.data.nextQuestion) {
        currentQuestion = answerRes.data.nextQuestion;
      } else {
        currentQuestion = null;
      }
    } else {
      fail(`Answer question ${i+1} failed`, JSON.stringify(answerRes.data));
      break;
    }
  }

  if (questionsAnswered >= 10 || (lastResponse && lastResponse.completed)) {
    pass(`Candidate completed all ${questionsAnswered} questions`);
  } else if (questionsAnswered > 0) {
    fail(`Only ${questionsAnswered}/10 questions answered`);
  }

  // --- CANDIDATE: View results ---
  if (testSessionId) {
    const resultRes = await api(`/assessments/session/${testSessionId}/current`, { token: candidateToken });
    if (resultRes.ok && resultRes.data.status === 'completed') {
      pass(`Assessment results available (Score: ${resultRes.data.score}, Passed: ${resultRes.data.passed})`);
    } else if (resultRes.ok) {
      fail('Assessment not marked completed', `Status: ${resultRes.data.status}`);
    } else {
      fail('Fetch assessment results failed', JSON.stringify(resultRes.data));
    }
  }

  // --- CANDIDATE: View past results ---
  const pastRes = await api('/assessments/results', { token: candidateToken });
  if (pastRes.ok && pastRes.data.results) {
    if (pastRes.data.results.length > 0) {
      pass(`Candidate sees past results (${pastRes.data.results.length} results)`);
    } else {
      fail('Past results empty despite completing assessment');
    }
  } else {
    fail('Fetch past results failed');
  }

  // --- CANDIDATE: Anti-cheat event logging ---
  if (testSessionId) {
    // Note: We already completed the session, but the event endpoint should still work
    // Actually for a completed session this might fail, so we just test the endpoint exists
    const eventRes = await api('/assessments/event', {
      token: candidateToken,
      method: 'POST',
      body: { sessionId: testSessionId, eventType: 'tab_switch', eventData: { timestamp: Date.now() } }
    });
    // We don't fail on this since the session is already completed
    if (eventRes.ok) {
      pass(`Anti-cheat event endpoint works`);
    } else {
      // Not a critical failure since session was completed
      log('⚠️', `Anti-cheat event on completed session: ${eventRes.data?.error || 'error'}`);
    }
  }

  // --- RECRUITER: View assessment results ---
  console.log('  [Recruiter Side]');
  const recAssessRes = await api('/assessments/recruiter/all', { token: recruiterToken });
  if (recAssessRes.ok) {
    const data = recAssessRes.data;
    if (data.assessments && data.stats) {
      pass(`Recruiter sees assessment results (${data.assessments.length} total)`);
      // Find our candidate's assessment
      if (candidateId) {
        const found = data.assessments.find(a => a.candidate_id === candidateId);
        if (found) {
          pass(`✨ BIDIRECTIONAL: Recruiter sees candidate's assessment result`);
        } else {
          fail('BIDIRECTIONAL FAIL: Recruiter cannot see candidate assessment');
        }
      }

      // Check stats
      if (data.stats.total_candidates !== undefined) {
        pass(`Assessment stats dashboard works (${data.stats.total_candidates} candidates tested)`);
      }

      // Check skill breakdown
      if (data.skillBreakdown && data.skillBreakdown.length > 0) {
        pass(`Skill breakdown available (${data.skillBreakdown.length} skills)`);
      }
    } else {
      fail('Recruiter assessments response missing data');
    }
  } else {
    fail('Recruiter fetch assessments failed', JSON.stringify(recAssessRes.data));
  }

  // --- RECRUITER: View assessment detail ---
  if (recAssessRes.ok && recAssessRes.data.assessments?.length > 0) {
    const firstAssessment = recAssessRes.data.assessments[0];
    const detailRes = await api(`/assessments/recruiter/detail/${firstAssessment.id}`, { token: recruiterToken });
    if (detailRes.ok && detailRes.data.assessment) {
      pass(`Recruiter views assessment detail`);
      if (detailRes.data.assessment.detailedAnswers?.length > 0) {
        pass(`Question-by-question breakdown available`);
      }
    } else {
      fail('Recruiter assessment detail failed');
    }
  }

  // --- RECRUITER: View skill catalog ---
  const recCatalogRes = await api('/assessments/recruiter/catalog', { token: recruiterToken });
  if (recCatalogRes.ok && recCatalogRes.data.catalog) {
    pass(`Recruiter sees skill catalog (${recCatalogRes.data.catalog.length} skills)`);
  } else {
    fail('Recruiter skill catalog failed');
  }
}

// ======================================
// MODULE 4: OFFERS
// ======================================
let testOfferId = null;

async function testOffers() {
  console.log('\n💼 MODULE 4: OFFERS');

  if (!testJobId || !candidateId) {
    skip('Skipping offers - no test job or candidate');
    return;
  }

  // --- RECRUITER: Create offer ---
  console.log('  [Recruiter Side]');
  const createRes = await api('/onboarding/offers', {
    token: recruiterToken,
    method: 'POST',
    body: {
      candidate_id: candidateId,
      job_id: testJobId,
      title: `QA Test Engineer - ${TS}`,
      salary: '95000',
      start_date: '2026-03-01',
      benefits: 'Health, Dental, 401k, Unlimited PTO',
    }
  });

  if (createRes.ok && createRes.data.id) {
    testOfferId = createRes.data.id;
    pass(`Recruiter created offer (ID: ${testOfferId})`);
  } else {
    fail('Recruiter create offer failed', JSON.stringify(createRes.data));
    return;
  }

  // --- RECRUITER: Send offer ---
  const sendRes = await api(`/onboarding/offers/${testOfferId}/send`, {
    token: recruiterToken,
    method: 'POST',
  });
  if (sendRes.ok && sendRes.data.status === 'sent') {
    pass(`Recruiter sent offer`);
  } else {
    fail('Recruiter send offer failed', JSON.stringify(sendRes.data));
  }

  // --- RECRUITER: View offers list ---
  const recOffersRes = await api('/onboarding/offers', { token: recruiterToken });
  if (recOffersRes.ok && Array.isArray(recOffersRes.data)) {
    const found = recOffersRes.data.find(o => o.id === testOfferId);
    if (found) {
      pass(`Recruiter sees offer in list`);
      if (found.candidate_name) {
        pass(`Offer shows candidate name: ${found.candidate_name}`);
      }
    } else {
      fail('Offer not found in recruiter list');
    }
  } else {
    fail('Recruiter list offers failed', JSON.stringify(recOffersRes.data));
  }

  // --- BIDIRECTIONAL: Candidate sees the offer ---
  console.log('  [Candidate Side]');
  const candOffersRes = await api('/onboarding/offers/me', { token: candidateToken });
  if (candOffersRes.ok && Array.isArray(candOffersRes.data)) {
    const found = candOffersRes.data.find(o => o.id === testOfferId);
    if (found) {
      pass(`✨ BIDIRECTIONAL: Candidate sees recruiter's offer`);
      // Verify offer details
      if (found.salary) {
        pass(`Offer shows salary: $${found.salary}`);
      }
      if (found.job_title || found.title) {
        pass(`Offer shows job title`);
      }
    } else {
      fail('BIDIRECTIONAL FAIL: Candidate cannot see offer',
           `Total offers: ${candOffersRes.data.length}`);
    }
  } else {
    fail('Candidate list offers failed', JSON.stringify(candOffersRes.data));
  }

  // --- CANDIDATE: View offer (track engagement) ---
  const viewRes = await api(`/onboarding/offers/${testOfferId}/view`, {
    token: candidateToken,
    method: 'POST',
  });
  if (viewRes.ok && viewRes.data.viewed_at) {
    pass(`Candidate viewed offer (tracked)`);
  } else {
    fail('Candidate view offer tracking failed', JSON.stringify(viewRes.data));
  }

  // --- TEST: Decline offer flow ---
  // First create a second offer to test decline
  const offer2Res = await api('/onboarding/offers', {
    token: recruiterToken,
    method: 'POST',
    body: {
      candidate_id: candidateId,
      job_id: testJobId,
      title: `Decline Test Offer - ${TS}`,
      salary: '80000',
      start_date: '2026-04-01',
      benefits: 'Basic package',
    }
  });

  let declineOfferId = null;
  if (offer2Res.ok && offer2Res.data.id) {
    declineOfferId = offer2Res.data.id;
    // Send it
    await api(`/onboarding/offers/${declineOfferId}/send`, { token: recruiterToken, method: 'POST' });

    // Candidate declines
    const declineRes = await api(`/onboarding/offers/${declineOfferId}/decline`, {
      token: candidateToken,
      method: 'POST',
      body: { decline_reason: 'Found a better opportunity for testing purposes.' }
    });
    if (declineRes.ok && declineRes.data.status === 'declined') {
      pass(`Candidate declined offer`);
    } else {
      fail('Candidate decline failed', JSON.stringify(declineRes.data));
    }

    // --- BIDIRECTIONAL: Recruiter sees declined status ---
    const recOffersAfter = await api('/onboarding/offers', { token: recruiterToken });
    if (recOffersAfter.ok && Array.isArray(recOffersAfter.data)) {
      const found = recOffersAfter.data.find(o => o.id === declineOfferId);
      if (found && found.status === 'declined') {
        pass(`✨ BIDIRECTIONAL: Recruiter sees declined status`);
        if (found.decline_reason) {
          pass(`Decline reason visible to recruiter`);
        } else {
          fail('Decline reason not visible to recruiter');
        }
      } else {
        fail('BIDIRECTIONAL FAIL: Recruiter does not see declined status');
      }
    }
  }

  // --- CANDIDATE: Accept the original offer ---
  const acceptRes = await api(`/onboarding/offers/${testOfferId}/accept`, {
    token: candidateToken,
    method: 'POST',
  });
  if (acceptRes.ok && acceptRes.data.status === 'accepted') {
    pass(`Candidate accepted offer`);
  } else {
    fail('Candidate accept offer failed', JSON.stringify(acceptRes.data));
  }

  // --- BIDIRECTIONAL: Recruiter sees accepted status ---
  const recFinalRes = await api('/onboarding/offers', { token: recruiterToken });
  if (recFinalRes.ok && Array.isArray(recFinalRes.data)) {
    const found = recFinalRes.data.find(o => o.id === testOfferId);
    if (found && found.status === 'accepted') {
      pass(`✨ BIDIRECTIONAL: Recruiter sees accepted status`);
    } else {
      fail('BIDIRECTIONAL FAIL: Recruiter does not see accepted status');
    }
  }

  // --- RECRUITER: Withdraw offer test ---
  const offer3Res = await api('/onboarding/offers', {
    token: recruiterToken,
    method: 'POST',
    body: {
      candidate_id: candidateId,
      job_id: testJobId,
      title: `Withdraw Test - ${TS}`,
      salary: '70000',
      start_date: '2026-05-01',
    }
  });
  if (offer3Res.ok && offer3Res.data.id) {
    const withdrawOfferId = offer3Res.data.id;
    // Send it first
    await api(`/onboarding/offers/${withdrawOfferId}/send`, { token: recruiterToken, method: 'POST' });

    // Withdraw
    const withdrawRes = await api(`/onboarding/offers/${withdrawOfferId}/withdraw`, {
      token: recruiterToken,
      method: 'POST',
    });
    if (withdrawRes.ok && withdrawRes.data.status === 'withdrawn') {
      pass(`Recruiter withdrew offer`);
    } else {
      fail('Recruiter withdraw offer failed', JSON.stringify(withdrawRes.data));
    }
  }
}

// ======================================
// ADDITIONAL: PAGE LOAD / REACT ROUTE CHECKS
// ======================================
async function testPageLoads() {
  console.log('\n🌐 PAGE LOAD TESTS');

  const pages = [
    { path: '/', name: 'Landing Page' },
    { path: '/login', name: 'Login Page' },
    { path: '/register', name: 'Register Page' },
  ];

  for (const page of pages) {
    try {
      const res = await fetch(`${BASE_URL}${page.path}`);
      if (res.ok) {
        const html = await res.text();
        if (html.includes('<!DOCTYPE html>') || html.includes('<div id="root">')) {
          pass(`${page.name} loads`);
        } else {
          fail(`${page.name} returns unexpected content`);
        }
      } else {
        fail(`${page.name} returns ${res.status}`);
      }
    } catch (err) {
      fail(`${page.name} unreachable`, err.message);
    }
  }

  // Test health endpoint
  try {
    const healthRes = await fetch(`${BASE_URL}/health`);
    const data = await healthRes.json();
    if (data.status === 'ok') {
      pass(`Health check OK`);
    } else {
      fail('Health check unexpected response');
    }
  } catch (err) {
    fail('Health check failed', err.message);
  }
}

// ======================================
// RECRUITER: Delete job test
// ======================================
async function testJobDelete() {
  console.log('\n🗑️ JOB DELETE TEST');

  // Create a temporary job to delete
  const createRes = await api('/jobs', {
    token: recruiterToken,
    method: 'POST',
    body: {
      title: `Delete Me - ${TS}`,
      description: 'This job will be deleted.',
      job_type: 'part-time',
    }
  });

  if (createRes.ok && createRes.data.job) {
    const tempJobId = createRes.data.job.id;

    const deleteRes = await api(`/jobs/${tempJobId}`, {
      token: recruiterToken,
      method: 'DELETE',
    });

    if (deleteRes.ok) {
      pass(`Job deleted successfully`);

      // Verify it's gone
      const checkRes = await api(`/jobs/${tempJobId}`, { token: recruiterToken });
      if (checkRes.status === 404) {
        pass(`Deleted job returns 404`);
      } else {
        fail('Deleted job still accessible');
      }
    } else {
      fail('Job delete failed', JSON.stringify(deleteRes.data));
    }
  }
}

// ======================================
// MAIN
// ======================================
async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║   HireLoop Phase 2 E2E QA Test Suite     ║');
  console.log('║   Jobs • Applications • Tests • Offers   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log(`\nTarget: ${BASE_URL}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // Page loads
  await testPageLoads();

  // Setup auth
  const authOk = await setupAuth();
  if (!authOk) {
    console.log('\n⛔ AUTH FAILED - Cannot continue');
    process.exit(1);
  }

  // Module tests
  await testJobs();
  await testApplications();
  await testSkillTests();
  await testOffers();
  await testJobDelete();

  // Summary
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║            QA RESULTS SUMMARY            ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║  ✅ Passed:  ${String(passed).padStart(3)}                          ║`);
  console.log(`║  ❌ Failed:  ${String(failed).padStart(3)}                          ║`);
  console.log(`║  ⏭️  Skipped: ${String(skipped).padStart(3)}                          ║`);
  console.log('╚══════════════════════════════════════════╝');

  if (bugs.length > 0) {
    console.log('\n🐛 BUGS FOUND:');
    bugs.forEach((bug, i) => {
      console.log(`  ${i+1}. ${bug}`);
    });
  } else {
    console.log('\n🎉 NO BUGS FOUND - All Phase 2 modules working!');
  }

  process.exit(bugs.length > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
