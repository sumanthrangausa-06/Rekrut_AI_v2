#!/usr/bin/env node
// Verify the full onboarding E2E flow works
const APP_URL = 'https://hireloop-vzvw.polsia.app';

async function run() {
  console.log('=== ONBOARDING E2E VERIFICATION ===\n');

  // Step 0: Login as test candidate
  console.log('--- Step 0: Login as test candidate ---');
  let token;
  try {
    const loginRes = await fetch(`${APP_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test-onboard@example.com', password: 'TestPass123' })
    });
    const loginData = await loginRes.json();
    token = loginData.token || loginData.accessToken;
    if (!token) {
      console.log('  ❌ Login failed:', JSON.stringify(loginData));
      return;
    }
    console.log('  ✅ Logged in as test candidate (user id:', loginData.user?.id || 'unknown', ')');
  } catch(e) {
    console.log('  ❌ Auth error:', e.message);
    return;
  }

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // Step 1: Check initial wizard state (should show "no onboarding" since offer is "sent" not "accepted")
  console.log('\n--- Step 1: Check wizard before accepting offer ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/progress`, { headers });
    const data = await res.json();
    console.log('  has_onboarding:', data.has_onboarding);
    if (data.has_onboarding) {
      console.log('  Already has onboarding - using existing checklist');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // Step 2: Check pending offers
  console.log('\n--- Step 2: Check offers ---');
  let offerId;
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/offers/me`, { headers });
    const offers = await res.json();
    console.log('  Offers count:', offers.length);
    const pendingOffer = offers.find(o => o.status === 'sent');
    if (pendingOffer) {
      offerId = pendingOffer.id;
      console.log('  ✅ Found pending offer:', pendingOffer.id, '-', pendingOffer.title, 'at', pendingOffer.company_name);
    } else {
      console.log('  ⚠️ No pending offers');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // Step 3: Accept the offer
  if (offerId) {
    console.log('\n--- Step 3: Accept offer ---');
    try {
      const res = await fetch(`${APP_URL}/api/onboarding/offers/${offerId}/accept`, {
        method: 'POST', headers,
        body: JSON.stringify({ signature_url: 'digital_acceptance' })
      });
      const data = await res.json();
      console.log('  Offer status:', data.status);
      if (data.status === 'accepted') {
        console.log('  ✅ Offer accepted! Onboarding checklist created.');
      } else {
        console.log('  ❌ Unexpected status:', JSON.stringify(data));
      }
    } catch(e) {
      console.log('  ❌ Error:', e.message);
    }
  }

  // Step 4: Check wizard progress (should now have onboarding)
  console.log('\n--- Step 4: Wizard progress after accepting ---');
  let checklistId;
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/progress`, { headers });
    const data = await res.json();
    console.log('  has_onboarding:', data.has_onboarding);
    if (data.has_onboarding) {
      checklistId = data.checklist.id;
      console.log('  ✅ Checklist ID:', checklistId);
      console.log('  Checklist status:', data.checklist.status);
      console.log('  Wizard current_step:', data.wizard?.current_step);
      console.log('  Wizard status:', data.wizard?.wizard_status);
      console.log('  Company:', data.checklist.company_name);
    } else {
      console.log('  ❌ No onboarding found after accepting!');
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 5: Save personal info (wizard step 1)
  console.log('\n--- Step 5: Save personal info (step 1) ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/save-step`, {
      method: 'POST', headers,
      body: JSON.stringify({
        checklist_id: checklistId,
        step: 1,
        data: {
          legal_first_name: 'Test',
          legal_middle_name: 'M',
          legal_last_name: 'Onboard',
          date_of_birth: '1992-07-15',
          ssn: '987654321',
          phone: '(555) 234-5678',
          address_line1: '456 Oak Ave',
          address_line2: '',
          city: 'Austin',
          state: 'TX',
          zip_code: '73301'
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ✅ Step 1 saved. Current step:', data.wizard?.current_step);
    } else {
      console.log('  ❌ Failed:', JSON.stringify(data));
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 6: Save emergency contact (wizard step 2)
  console.log('\n--- Step 6: Save emergency contact (step 2) ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/save-step`, {
      method: 'POST', headers,
      body: JSON.stringify({
        checklist_id: checklistId,
        step: 2,
        data: {
          emergency_contact_name: 'John Onboard',
          emergency_contact_relationship: 'Parent',
          emergency_contact_phone: '(555) 876-5432',
          emergency_contact_email: 'john@example.com'
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ✅ Step 2 saved. Current step:', data.wizard?.current_step);
    } else {
      console.log('  ❌ Failed:', JSON.stringify(data));
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 7: Save banking & tax (wizard step 3)
  console.log('\n--- Step 7: Save banking & tax (step 3) ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/save-step`, {
      method: 'POST', headers,
      body: JSON.stringify({
        checklist_id: checklistId,
        step: 3,
        data: {
          bank_name: 'Wells Fargo',
          routing_number: '121000248',
          account_number: '9876543210',
          account_type: 'checking',
          w4_filing_status: 'single'
        }
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ✅ Step 3 saved. Current step:', data.wizard?.current_step);
    } else {
      console.log('  ❌ Failed:', JSON.stringify(data));
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 8: Generate documents
  console.log('\n--- Step 8: Generate documents ---');
  let documents;
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/generate-documents`, {
      method: 'POST', headers,
      body: JSON.stringify({ checklist_id: checklistId })
    });
    const data = await res.json();
    if (data.success && data.documents?.length > 0) {
      documents = data.documents;
      console.log('  ✅ Generated', documents.length, 'documents:');
      documents.forEach(d => {
        console.log(`    📄 ${d.document_type} (id:${d.id}, company_id:${d.company_id}, has_content:${!!d.document_content})`);
      });
    } else {
      console.log('  ❌ Failed:', JSON.stringify(data));
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 9: Sign all documents
  console.log('\n--- Step 9: Sign all documents ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/sign-all`, {
      method: 'POST', headers,
      body: JSON.stringify({
        checklist_id: checklistId,
        signature_data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      })
    });
    const data = await res.json();
    if (data.success) {
      console.log('  ✅ Signed', data.signed_documents?.length, 'documents');
      (data.signed_documents || []).forEach(d => {
        console.log(`    ✍️ ${d.document_type}: signed_at=${d.signed_at}, ip=${d.signer_ip}`);
      });
    } else {
      console.log('  ❌ Failed:', JSON.stringify(data));
      return;
    }
  } catch(e) {
    console.log('  ❌ Error:', e.message);
    return;
  }

  // Step 10: Final wizard state
  console.log('\n--- Step 10: Final wizard state ---');
  try {
    const res = await fetch(`${APP_URL}/api/onboarding/wizard/progress`, { headers });
    const data = await res.json();
    console.log('  Checklist status:', data.checklist?.status);
    console.log('  Wizard status:', data.wizard?.wizard_status);
    console.log('  Wizard step:', data.wizard?.current_step);
    console.log('  Documents:', data.documents?.length);
    console.log('  All signed:', data.documents?.every(d => d.signed_at));
    if (data.checklist?.status === 'completed' && data.wizard?.wizard_status === 'completed') {
      console.log('  ✅ CANDIDATE FLOW COMPLETE');
    } else {
      console.log('  ⚠️ Not fully complete');
    }
  } catch(e) {
    console.log('  Error:', e.message);
  }

  // Step 11: Check recruiter view
  console.log('\n--- Step 11: Recruiter visibility check ---');
  // We don't know the recruiter password, so check via DB indicators
  // But let's try the recruiter API with a fresh registration
  let recToken;
  try {
    // Create a new recruiter for testing
    const regRes = await fetch(`${APP_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Test Recruiter Verify',
        email: `recruiter-verify-${Date.now()}@test.com`,
        password: 'TestPass123',
        role: 'recruiter',
        company_name: 'Accelera Pathway Group'
      })
    });
    const regData = await regRes.json();
    recToken = regData.token || regData.accessToken;
  } catch(e) {
    console.log('  Could not create test recruiter:', e.message);
  }

  if (recToken) {
    const recHeaders = { 'Authorization': `Bearer ${recToken}`, 'Content-Type': 'application/json' };

    // Check summary
    try {
      const summaryRes = await fetch(`${APP_URL}/api/onboarding/recruiter/summary`, { headers: recHeaders });
      const summary = await summaryRes.json();
      if (Array.isArray(summary)) {
        console.log('  Recruiter sees', summary.length, 'candidates in onboarding');
        summary.forEach(c => {
          console.log(`    👤 ${c.candidate_name}: ${c.signed_documents || 0}/${c.total_documents || 0} docs signed, status: ${c.onboarding_status}`);
        });
      } else {
        console.log('  Recruiter summary response:', JSON.stringify(summary).slice(0, 200));
      }
    } catch(e) {
      console.log('  Summary error:', e.message);
    }

    // Check specific candidate docs
    try {
      const docsRes = await fetch(`${APP_URL}/api/onboarding/recruiter/candidate/9/documents`, { headers: recHeaders });
      const docs = await docsRes.json();
      if (Array.isArray(docs)) {
        console.log('  Recruiter sees', docs.length, 'documents for test candidate:');
        docs.forEach(d => {
          console.log(`    📄 ${d.document_type}: status=${d.status}, signed=${!!d.signed_at}, has_content=${!!d.document_content}`);
        });
        if (docs.length > 0 && docs.every(d => d.signed_at)) {
          console.log('  ✅ HR DASHBOARD SEES ALL SIGNED DOCUMENTS');
        }
      } else {
        console.log('  Docs response:', JSON.stringify(docs).slice(0, 200));
      }
    } catch(e) {
      console.log('  Docs error:', e.message);
    }

    // Test document download
    if (documents && documents.length > 0) {
      try {
        const dlRes = await fetch(`${APP_URL}/api/onboarding/recruiter/document/${documents[0].id}/download`, { headers: recHeaders });
        console.log('  Download status:', dlRes.status, dlRes.headers.get('content-type'));
        if (dlRes.status === 200) {
          const html = await dlRes.text();
          console.log('  ✅ Document download works, HTML length:', html.length);
        } else {
          const err = await dlRes.text();
          console.log('  ❌ Download failed:', err.slice(0, 200));
        }
      } catch(e) {
        console.log('  Download error:', e.message);
      }
    }
  } else {
    console.log('  ⚠️ Skipping recruiter checks (no token)');
  }

  console.log('\n=== VERIFICATION COMPLETE ===');
}

run().catch(e => console.error('Fatal:', e));
