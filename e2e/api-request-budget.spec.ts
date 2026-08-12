import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'
const RECRUITER_STORAGE = 'e2e/.auth/recruiter.json'

function getToken(path: string): string {
  const data = JSON.parse(fs.readFileSync(path, 'utf-8'))
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000')
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || ''
}

// ───────────────────────────────────────────────
// API Request Count Budget Test
// Regression guard against render-loop API spam.
// For each major page, count API requests and assert under budget.
// ───────────────────────────────────────────────

/**
 * Collects all API requests made during a page navigation/operation.
 * Filters to only count requests to /api/* endpoints.
 */
async function countApiRequests(
  page: import('@playwright/test').Page,
  operation: () => Promise<void>,
  options: { settleMs?: number; excludePatterns?: RegExp[] } = {}
): Promise<{ count: number; urls: string[] }> {
  const requests: string[] = []
  const settleMs = options.settleMs ?? 3000
  const excludePatterns = options.excludePatterns ?? []

  const handler = (req: import('@playwright/test').Request) => {
    const url = req.url()
    if (url.includes('/api/') && !excludePatterns.some((p) => p.test(url))) {
      requests.push(url)
    }
  }

  page.on('request', handler)

  try {
    await operation()
    // Wait for the page to settle — allow any background polling to fire
    await page.waitForTimeout(settleMs)
  } finally {
    page.off('request', handler)
  }

  return { count: requests.length, urls: requests }
}

// ─── Candidate Pages ───
test.describe('API Budget: Candidate Pages', () => {
  test.use({ storageState: CANDIDATE_STORAGE })

  test('candidate dashboard API budget ≤ 8 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/candidate')
      await page.waitForLoadState('domcontentloaded')
      // Wait for dashboard content
      await expect(
        page.getByText(/Welcome back|Dashboard|active jobs/i).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[candidate dashboard] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(8)
  })

  test('candidate jobs list API budget ≤ 6 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/candidate/jobs')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByText(/Find Your Next Opportunity|active jobs|results/i).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[candidate jobs] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(6)
  })

  test('candidate profile API budget ≤ 6 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/candidate/profile')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: /Profile|Settings|Personal Information/i }).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[candidate profile] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(6)
  })

  test('candidate assessments API budget ≤ 6 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/candidate/assessments')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: 'Skill Assessments' })
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[candidate assessments] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(6)
  })

  test('candidate applications API budget ≤ 6 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/candidate/applications')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: /My Applications/i }).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[candidate applications] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(6)
  })

  // ─── Regression: No render-loop spam ───
  test('no duplicate identical API calls within 3 seconds of page load', async ({ page }) => {
    const requestCounts: Record<string, number> = {}

    const handler = (req: import('@playwright/test').Request) => {
      const url = req.url()
      if (url.includes('/api/')) {
        // Normalize URL by removing query params for dedup check
        const baseUrl = url.split('?')[0]
        requestCounts[baseUrl] = (requestCounts[baseUrl] || 0) + 1
      }
    }

    page.on('request', handler)

    await page.goto('/candidate')
    await page.waitForLoadState('domcontentloaded')
    await expect(
      page.getByText(/Welcome back|Dashboard/i).first()
    ).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(3000)

    page.off('request', handler)

    // Check no URL was called more than 3 times (allows for intentional retries/polling)
    const duplicates = Object.entries(requestCounts).filter(([_, count]) => count > 3)

    if (duplicates.length > 0) {
      console.log('Duplicate API calls detected:')
      duplicates.forEach(([url, count]) => console.log(`  ${url}: ${count} calls`))
    }

    expect(duplicates).toHaveLength(0)
  })
})

// ─── Recruiter Pages ───
test.describe('API Budget: Recruiter Pages', () => {
  test.use({ storageState: RECRUITER_STORAGE })

  test('recruiter dashboard API budget ≤ 10 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/recruiter')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByText(/Welcome back|Active Jobs|Dashboard|Recruiter/i).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[recruiter dashboard] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(10)
  })

  test('recruiter jobs list API budget ≤ 8 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/recruiter/jobs')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: /Jobs|My Jobs/i }).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[recruiter jobs] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(8)
  })

  test('recruiter candidates API budget ≤ 8 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/recruiter/candidates')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: /Candidates|Pipeline/i }).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[recruiter candidates] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(8)
  })

  test('recruiter analytics API budget ≤ 10 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/recruiter/analytics')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByRole('heading', { name: /Hiring Analytics|Analytics/i }).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[recruiter analytics] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(10)
  })

  test('recruiter team page API budget ≤ 6 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/recruiter/team')
      await page.waitForLoadState('domcontentloaded')
      // Wait for either team page or redirect (non-owner)
      await page.waitForTimeout(1500)
    })

    console.log(`[recruiter team] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(6)
  })
})

// ─── Public Pages (no auth) ───
test.describe('API Budget: Public Pages', () => {
  test('landing page API budget ≤ 4 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/')
      await page.waitForLoadState('domcontentloaded')
      await expect(page.locator('h1').first()).toBeVisible({ timeout: 15000 })
    })

    console.log(`[landing page] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(4)
  })

  test('jobs public page API budget ≤ 4 requests', async ({ page }) => {
    const { count, urls } = await countApiRequests(page, async () => {
      await page.goto('/jobs')
      await page.waitForLoadState('domcontentloaded')
      await expect(
        page.getByText(/Find Your Next Opportunity|active jobs|results/i).first()
      ).toBeVisible({ timeout: 15000 })
    })

    console.log(`[public jobs] API requests: ${count}`)
    urls.forEach((u) => console.log(`  → ${u}`))

    expect(count).toBeLessThanOrEqual(4)
  })
})
