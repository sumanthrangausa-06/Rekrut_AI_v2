import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'
const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.use({ storageState: RECRUITER_STORAGE })

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'))
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000')
  const token = origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value
  return token || ''
}

test.describe('Recruiter Applicant Review Flow', () => {
  test('recruiter views applicants, opens profile, shortlists and rejects candidate', async ({ page, request }) => {
    test.setTimeout(90000)

    const jobTitle = `E2E Review Flow ${Date.now()}`
    const recruiterToken = getToken(RECRUITER_STORAGE)
    const candidateToken = getToken(CANDIDATE_STORAGE)

    // ─── 1. Seed job via API ───
    const createRes = await request.post('/api/jobs', {
      headers: { Authorization: `Bearer ${recruiterToken}` },
      data: {
        title: jobTitle,
        company: 'E2E Review Co',
        description: 'End-to-end QA testing position for applicant review flow.',
        requirements: 'Playwright, TypeScript, E2E testing.',
        location: 'Remote',
        salary_range: '$85,000 - $110,000',
        job_type: 'full-time',
        screening_questions: [],
      },
    })
    if (!createRes.ok()) {
      throw new Error(`Failed to seed job: ${createRes.status()} ${await createRes.text()}`)
    }
    const jobData = await createRes.json()
    const jobId = jobData.job?.id || jobData.id
    if (!jobId) throw new Error('Job creation did not return an ID')

    // ─── 2. Apply as candidate via API ───
    const applyRes = await request.post(`/api/candidate/jobs/${jobId}/apply`, {
      headers: { Authorization: `Bearer ${candidateToken}` },
      data: {
        cover_letter: 'I am excited about this opportunity and believe my skills align well.',
        screening_answers: {},
      },
    })
    if (!applyRes.ok()) {
      throw new Error(`Failed to apply as candidate: ${applyRes.status()} ${await applyRes.text()}`)
    }

    // ─── 3. Navigate to job applicants page ───
    await page.goto(`/recruiter/jobs/${jobId}/applicants`)
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)

    // Verify pipeline heading and applicant count
    await expect(page.getByRole('heading', { name: 'Pipeline' }).first()).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/1 applicant/).first()).toBeVisible({ timeout: 15000 })

    // ─── 4. Switch to list view to interact with applicant card ───
    await page.getByRole('button', { name: 'List' }).first().click()
    await page.waitForTimeout(500)

    // Click the applicant card to open the profile dialog
    await page.getByText('E2E Candidate').first().click()
    await page.waitForTimeout(500)

    // Verify dialog opened with candidate profile
    await expect(page.getByRole('heading', { name: /E2E Candidate/i }).first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Match Score').first()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('OmniScore').first()).toBeVisible({ timeout: 10000 })

    // ─── 5. Shortlist candidate via status select in dialog ───
    // The dialog is rendered after the list view, so its select is the last one
    const statusSelect = page.locator('select').last()
    await statusSelect.selectOption('shortlisted')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Save & Close' }).click()
    await page.waitForTimeout(800)

    // Verify applicant status badge shows "Shortlisted" in list view
    // The badge is a <div> element, distinct from the <option> inside the select
    await expect(page.locator('div:has-text("Shortlisted")').first()).toBeVisible({ timeout: 10000 })

    // ─── 6. Open candidate profile again and reject ───
    await page.getByText('E2E Candidate').first().click()
    await page.waitForTimeout(500)

    await expect(page.getByRole('heading', { name: /E2E Candidate/i }).first()).toBeVisible({ timeout: 10000 })

    const statusSelect2 = page.locator('select').last()
    await statusSelect2.selectOption('rejected')
    await page.waitForTimeout(1000)

    await page.getByRole('button', { name: 'Save & Close' }).click()
    await page.waitForTimeout(800)

    // Verify applicant status badge shows "Rejected" in list view
    await expect(page.locator('div:has-text("Rejected")').first()).toBeVisible({ timeout: 10000 })
  })
})
