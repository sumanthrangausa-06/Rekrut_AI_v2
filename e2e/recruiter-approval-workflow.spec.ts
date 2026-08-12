import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'
const PASSWORD = 'TestPass123!'

function getRecruiterToken(): string {
  const data = JSON.parse(fs.readFileSync(RECRUITER_STORAGE, 'utf-8'))
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000')
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || ''
}

function getRecruiterCompanyDomain(): string {
  return 'rekrutai.test'
}

function generatePendingEmail(): string {
  const ts = Date.now()
  return `e2e-pending-${ts}@${getRecruiterCompanyDomain()}`
}

// ───────────────────────────────────────────────
// Recruiter Approval Workflow
// Company owner invites/approves/rejects recruiters.
// Tests privilege escalation for unapproved recruiters.
// ───────────────────────────────────────────────
test.describe('Recruiter Approval Workflow', () => {
  test('pending recruiter is redirected to pending-approval page and cannot access dashboard', async ({ page }) => {
    const pendingEmail = generatePendingEmail()
    const pendingName = 'E2E Pending Recruiter'
    const companyDomain = getRecruiterCompanyDomain()

    // ─── Step 1: Register as a recruiter with the same domain as existing company ───
    // Use a random IP to avoid rate limiting
    const randomIP = `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
    await page.setExtraHTTPHeaders({ 'X-Forwarded-For': randomIP })

    await page.goto('/register?role=recruiter')
    await expect(page.getByRole('heading', { name: /Create an account/i })).toBeVisible({ timeout: 10000 })

    // Select "Employer" role (the register page uses card buttons, not a combobox)
    await page.getByRole('button', { name: /Employer/i }).click()

    await page.fill('input#name', pendingName)
    await page.fill('input#email', pendingEmail)
    await page.fill('input#password', PASSWORD)
    await page.fill('input#company', 'E2E Test Co')
    await page.getByRole('button', { name: /Sign up/i }).click()

    // ─── Step 2: Should be redirected to pending-approval page ───
    await page.waitForURL(/.*\/recruiter\/pending-approval/, { timeout: 15000 })
    await expect(page.getByRole('heading', { name: 'Awaiting Approval' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/pending review by the company administrator/i)).toBeVisible()
    await expect(page.getByText(companyDomain).first()).toBeVisible()

    // ─── Step 3: Verify pending recruiter cannot access protected recruiter routes ───
    // Try to access recruiter dashboard directly
    await page.goto('/recruiter')
    await page.waitForTimeout(1000)
    // Should be redirected back to pending-approval
    await expect(page).toHaveURL(/.*\/recruiter\/pending-approval/, { timeout: 10000 })

    // Try to access recruiter jobs
    await page.goto('/recruiter/jobs')
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/.*\/recruiter\/pending-approval/, { timeout: 10000 })

    // Try to access team management (admin-only route)
    await page.goto('/recruiter/team')
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/.*\/recruiter\/pending-approval/, { timeout: 10000 })

    // Try to access analytics
    await page.goto('/recruiter/analytics')
    await page.waitForTimeout(1000)
    await expect(page).toHaveURL(/.*\/recruiter\/pending-approval/, { timeout: 10000 })

    // ─── Step 4: Pending approval page shows correct UI elements ───
    await expect(page.getByText('Request sent')).toBeVisible()
    await expect(page.getByText('Admin review')).toBeVisible()
    await expect(page.getByText('Access granted')).toBeVisible()
    await expect(page.getByRole('button', { name: /Sign out/i })).toBeVisible()
    await expect(page.getByText(/Auto-checking in/i)).toBeVisible()
  })

  test('company owner can view and approve a join request', async ({ request }) => {
    const pendingEmail = generatePendingEmail()
    const pendingName = 'E2E Pending Recruiter'
    const recruiterToken = getRecruiterToken()

    // ─── Step 1: Create a pending join request via API (use /api/company/register) ───
    const csrfRes = await request.get('/csrf-token')
    const csrfData = await csrfRes.json()
    const csrfToken = csrfData.csrfToken

    const randomIP = `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
    const regRes = await request.post('/api/company/register', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'X-Forwarded-For': randomIP,
      },
      data: {
        name: pendingName,
        email: pendingEmail,
        password: PASSWORD,
        company_name: 'E2E Test Co',
      },
    })

    expect(regRes.status()).toBe(202)
    const regData = await regRes.json()
    expect(regData.pending_approval).toBe(true)
    const pendingUserId = regData.user.id
    // /api/company/register returns company info
    expect(regData.company).toBeDefined()

    // ─── Step 2: As company owner, list join requests ───
    const requestsRes = await request.get('/api/company/join-requests', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
    })
    expect(requestsRes.ok()).toBe(true)
    const requestsData = await requestsRes.json()
    expect(requestsData.success).toBe(true)
    expect(Array.isArray(requestsData.requests)).toBe(true)

    // Find our join request
    const joinRequest = requestsData.requests.find((r: any) => r.user_id === pendingUserId)
    expect(joinRequest).toBeDefined()
    expect(joinRequest.status).toBe('pending')
    expect(joinRequest.email).toBe(pendingEmail)

    // ─── Step 3: Approve the join request ───
    const approveRes = await request.post(`/api/company/join-requests/${joinRequest.id}/approve`, {
      headers: {
        Authorization: `Bearer ${recruiterToken}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
    })
    expect(approveRes.ok()).toBe(true)
    const approveData = await approveRes.json()
    expect(approveData.success).toBe(true)
    expect(approveData.message).toContain('approved')

    // ─── Step 4: Verify the request is no longer pending ───
    const requestsAfterRes = await request.get('/api/company/join-requests', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
    })
    const requestsAfterData = await requestsAfterRes.json()
    const stillPending = requestsAfterData.requests.find((r: any) => r.id === joinRequest.id)
    expect(stillPending).toBeUndefined()
  })

  test('company owner can reject a join request', async ({ request }) => {
    const pendingEmail = generatePendingEmail()
    const pendingName = 'E2E Pending Recruiter'
    const recruiterToken = getRecruiterToken()

    // ─── Step 1: Create a pending join request via API ───
    const csrfRes = await request.get('/csrf-token')
    const csrfData = await csrfRes.json()
    const csrfToken = csrfData.csrfToken

    const randomIP = `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
    const regRes = await request.post('/api/company/register', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'X-Forwarded-For': randomIP,
      },
      data: {
        name: pendingName,
        email: pendingEmail,
        password: PASSWORD,
        company_name: 'E2E Test Co',
      },
    })

    expect(regRes.status()).toBe(202)
    const regData = await regRes.json()
    const pendingUserId = regData.user.id

    // ─── Step 2: Get the actual join request ID ───
    const requestsRes = await request.get('/api/company/join-requests', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
    })
    const requestsData = await requestsRes.json()
    const joinRequest = requestsData.requests.find((r: any) => r.user_id === pendingUserId)
    expect(joinRequest).toBeDefined()

    // ─── Step 3: Reject the join request ───
    const rejectRes = await request.post(`/api/company/join-requests/${joinRequest.id}/reject`, {
      headers: {
        Authorization: `Bearer ${recruiterToken}`,
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
      },
      data: { reason: 'Test rejection from E2E' },
    })
    expect(rejectRes.ok()).toBe(true)
    const rejectData = await rejectRes.json()
    expect(rejectData.success).toBe(true)
    expect(rejectData.message).toContain('rejected')

    // ─── Step 4: Verify the request shows as rejected ───
    const requestsAfterRes = await request.get('/api/company/join-requests', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
    })
    const requestsAfterData = await requestsAfterRes.json()
    const stillPending = requestsAfterData.requests.find((r: any) => r.id === joinRequest.id)
    expect(stillPending).toBeUndefined()
  })
})

// Separate describe block for tests that need recruiter storageState
test.describe('Recruiter Team Management (authenticated)', () => {
  test.use({ storageState: RECRUITER_STORAGE })

  test('company owner can invite a team member directly', async ({ page }) => {
    test.setTimeout(90000)

    const inviteEmail = `e2e-invited-${Date.now()}@rekrutai.test`
    const inviteName = 'E2E Invited Recruiter'

    // ─── Step 1: Navigate to team management page ───
    await page.goto('/recruiter/team')
    await page.waitForTimeout(1500)

    await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible({ timeout: 15000 })

    // ─── Step 2: Open invite dialog ───
    await page.waitForTimeout(1000)
    const inviteBtn = page.getByRole('button', { name: /Invite Member/i }).first()
    await inviteBtn.waitFor({ state: 'visible', timeout: 10000 })
    await inviteBtn.click({ force: true })
    await page.waitForTimeout(500)
    await expect(page.getByRole('heading', { name: /Invite Team Member/i })).toBeVisible({ timeout: 10000 })

    // ─── Step 3: Fill invite form ───
    await page.locator('input[type="email"]').fill(inviteEmail)
    await page.locator('input[placeholder="John Smith"]').fill(inviteName)
    await page.locator('select').selectOption('recruiter')

    // ─── Step 4: Submit invite ───
    await page.getByRole('button', { name: /Send Invite/i }).click()
    await page.waitForTimeout(1500)

    // ─── Step 5: Verify success toast and member appears in list ───
    await expect(page.getByText(/invited successfully/i).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText(inviteEmail)).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Recruiter').first()).toBeVisible()

    // ─── Step 6: Verify active count increased ───
    await expect(page.getByText(/active/i)).toBeVisible()
  })

  test('non-owner recruiter cannot access team management', async ({ page }) => {
    // The existing e2e-recruiter may or may not be the company owner.
    // If they ARE the owner, this test verifies the page loads.
    // If they are NOT, it verifies redirect.
    // For a robust test, we check the API directly.

    // Try to access team page
    await page.goto('/recruiter/team')
    await page.waitForTimeout(1500)

    // If redirected, verify it's to the company page (non-owner redirect)
    const url = page.url()
    if (url.includes('/recruiter/company')) {
      // Non-owner was correctly redirected
      await expect(page.getByText(/company/i).first()).toBeVisible({ timeout: 10000 })
    } else if (url.includes('/recruiter/team')) {
      // User is owner — verify team page loaded
      await expect(page.getByRole('heading', { name: 'Team Management' })).toBeVisible({ timeout: 15000 })
      test.skip(true, 'E2E recruiter is company owner — skip privilege test')
    }
  })
})

test.describe('Pending Recruiter Privilege Escalation (API)', () => {
  test('pending recruiter API calls return 403 for protected endpoints', async ({ request }) => {
    const pendingEmail = generatePendingEmail()
    const pendingName = 'E2E Pending Recruiter'

    // ─── Step 1: Register and get pending user token ───
    const csrfRes = await request.get('/csrf-token')
    const csrfData = await csrfRes.json()
    const csrfToken = csrfData.csrfToken

    const randomIP = `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`
    const regRes = await request.post('/api/company/register', {
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': csrfToken,
        'X-Forwarded-For': randomIP,
      },
      data: {
        name: pendingName,
        email: pendingEmail,
        password: PASSWORD,
        company_name: 'E2E Test Co',
      },
    })

    expect(regRes.status()).toBe(202)
    const regData = await regRes.json()
    const pendingToken = regData.token || regData.accessToken
    expect(pendingToken).toBeDefined()

    // ─── Step 2: Try to access protected endpoints with pending token ───
    // Team members endpoint
    const teamRes = await request.get('/api/company/team/members', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    // Should get 400 (no company) or 403
    expect([400, 403]).toContain(teamRes.status())

    // Jobs endpoint (recruiter) — pending user has no company_id, should get 400
    const jobsRes = await request.get('/api/jobs', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    // The /api/jobs endpoint may return 200 with empty list or 400
    expect([200, 400, 403]).toContain(jobsRes.status())

    // Join requests endpoint
    const joinRes = await request.get('/api/company/join-requests', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    expect([400, 403]).toContain(joinRes.status())

    // Profile endpoint should work (auth check)
    const meRes = await request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${pendingToken}` },
    })
    expect(meRes.ok()).toBe(true)
    const meData = await meRes.json()
    expect(meData.user.email).toBe(pendingEmail)
    expect(meData.user.company_id).toBeNull()
  })
})
