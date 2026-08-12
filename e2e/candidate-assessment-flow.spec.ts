import { test, expect } from '@playwright/test'
import * as fs from 'fs'

const CANDIDATE_STORAGE = 'e2e/.auth/candidate.json'

test.use({ storageState: CANDIDATE_STORAGE })

function getCandidateToken(): string {
  const data = JSON.parse(fs.readFileSync(CANDIDATE_STORAGE, 'utf-8'))
  const origin = data.origins?.find((o: any) => o.origin === 'http://localhost:3000')
  return origin?.localStorage?.find((item: any) => item.name === 'rekrutai_token')?.value || ''
}

// ───────────────────────────────────────────────
// Candidate Assessment / Screening Flow E2E Tests
// Tests: start assessment, submit answers, view results, abandoned flow
// ───────────────────────────────────────────────
test.describe('Candidate Assessment Flow', () => {
  test('candidate can view assessments page with available tests and results', async ({ page }) => {
    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    // Page header
    await expect(page.getByRole('heading', { name: 'Skill Assessments' })).toBeVisible({ timeout: 15000 })
    await expect(page.getByText(/Verify your skills with AI-powered assessments/i)).toBeVisible()

    // Stats cards
    await expect(page.getByText('Tests Taken')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Passed')).toBeVisible()
    await expect(page.getByText('Verified Skills')).toBeVisible()

    // Tabs
    await expect(page.getByRole('tab', { name: 'Available Tests' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'My Results' })).toBeVisible()

    // Available tests tab should show skill categories
    await expect(page.getByText('Technical Skills').first()).toBeVisible({ timeout: 10000 })

    // Should see at least one skill card
    const skillCards = page.locator('.grid > div')
    const cardCount = await skillCards.count()
    expect(cardCount).toBeGreaterThan(0)
  })

  test('candidate can start an assessment and see the question interface', async ({ page }) => {
    test.setTimeout(90000)

    // Mock the assessment start API to avoid AI rate limits
    await page.route('/api/assessments/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 999999,
          skillName: 'JavaScript',
          question: {
            id: 1,
            text: 'What is the output of `typeof null` in JavaScript?',
            type: 'multiple_choice',
            options: ['"null"', '"undefined"', '"object"', '"number"'],
            timeLimit: 120,
            questionNumber: 1,
            totalQuestions: 10,
          },
        }),
      })
    })

    // Mock the answer submission
    await page.route('/api/assessments/answer', async (route) => {
      const postData = route.request().postData()
      const body = postData ? JSON.parse(postData) : {}

      if (body.questionId === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            completed: true,
            score: 85,
            feedback: 'Correct!',
            explanation: 'typeof null returns "object" in JavaScript.',
            aiFeedback: null,
          }),
        })
      } else {
        await route.continue()
      }
    })

    // Mock the session current endpoint
    await page.route('/api/assessments/session/999999/current', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'completed',
          skillName: 'JavaScript',
          score: 85,
          passed: true,
          antiCheatScore: 100,
          durationSeconds: 45,
          maxDifficultyReached: 3,
        }),
      })
    })

    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    // Find and click a Start Test button
    const startBtn = page.getByRole('button', { name: /Start Test|Try Again|Retake/i }).first()
    await expect(startBtn).toBeVisible({ timeout: 10000 })

    const skillName = await page.locator('h4').first().textContent() || 'Unknown'
    await startBtn.click()

    // Should navigate to assessment take page
    await page.waitForURL(/.*\/candidate\/assessments\/\d+\/take/, { timeout: 10000 })
    await page.waitForTimeout(1000)

    // Verify question interface
    await expect(page.getByText(/Question \d+ of \d+/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('What is the output of')).toBeVisible({ timeout: 15000 })

    // Select an answer
    const optionC = page.locator('button').filter({ hasText: '"object"' }).first()
    await expect(optionC).toBeVisible({ timeout: 10000 })
    await optionC.click()

    // Submit the answer (finish button for last question)
    const submitBtn = page.getByRole('button', { name: /Finish|Next/i }).first()
    await submitBtn.click()
    await page.waitForTimeout(1500)

    // Should show completion screen or redirect to results
    await expect(
      page.locator('text=/Assessment Passed|Assessment Complete|85|score/i').first()
    ).toBeVisible({ timeout: 15000 })
  })

  test('candidate abandoned assessment flow — leaving and returning', async ({ page }) => {
    test.setTimeout(90000)

    // Mock the assessment start API
    await page.route('/api/assessments/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 999998,
          skillName: 'Python',
          question: {
            id: 10,
            text: 'What is the result of `[1, 2, 3][::-1]` in Python?',
            type: 'multiple_choice',
            options: ['[1, 2, 3]', '[3, 2, 1]', 'Error', 'None'],
            timeLimit: 120,
            questionNumber: 3,
            totalQuestions: 10,
          },
        }),
      })
    })

    // Mock session current for abandoned state
    await page.route('/api/assessments/session/999998/current', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'in_progress',
          skillName: 'Python',
          question: {
            id: 10,
            text: 'What is the result of `[1, 2, 3][::-1]` in Python?',
            type: 'multiple_choice',
            options: ['[1, 2, 3]', '[3, 2, 1]', 'Error', 'None'],
            timeLimit: 120,
            questionNumber: 3,
            totalQuestions: 10,
          },
        }),
      })
    })

    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    // Start an assessment
    const startBtn = page.getByRole('button', { name: /Start Test|Try Again|Retake/i }).first()
    await startBtn.click()

    // Should be on assessment take page
    await page.waitForURL(/.*\/candidate\/assessments\/\d+\/take/, { timeout: 10000 })
    await page.waitForTimeout(1000)

    // Verify we're on question 3 of 10 (simulating resumed/abandoned state)
    await expect(page.getByText(/Question 3 of 10/i)).toBeVisible({ timeout: 15000 })

    // ─── Simulate abandonment: navigate away without answering ───
    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    // Should be back on assessments page
    await expect(page.getByRole('heading', { name: 'Skill Assessments' })).toBeVisible({ timeout: 10000 })

    // ─── Return to assessment via URL ───
    await page.goto('/candidate/assessments/999998/take')
    await page.waitForTimeout(1000)

    // Should resume showing the same question
    await expect(page.getByText(/Question 3 of 10/i)).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('What is the result of')).toBeVisible({ timeout: 15000 })
  })

  test('candidate results page shows past assessments', async ({ page }) => {
    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    // Click on My Results tab
    const resultsTab = page.getByRole('tab', { name: 'My Results' })
    await expect(resultsTab).toBeVisible()
    await resultsTab.click()
    await page.waitForTimeout(800)

    // Results tab content should load without error
    // Either shows results or empty state
    const hasResults = await page.locator('text=/Passed|Failed|score/i').first().isVisible().catch(() => false)
    const hasEmptyState = await page.getByText(/No assessment results yet/i).first().isVisible().catch(() => false)

    expect(hasResults || hasEmptyState).toBe(true)

    // If there are results, verify structure
    if (hasResults) {
      await expect(page.getByText(/Score:/i).first()).toBeVisible({ timeout: 10000 })
    }
  })

  test('assessment page handles network errors gracefully', async ({ page }) => {
    // Block the available assessments API
    await page.route('/api/assessments/available', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Server error' }),
      })
    })

    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1500)

    // Page should still render with header
    await expect(page.getByRole('heading', { name: 'Skill Assessments' })).toBeVisible({ timeout: 15000 })

    // Stats cards may show 0 or loading state
    await expect(page.getByText('Tests Taken').first()).toBeVisible({ timeout: 10000 })
  })

  test('assessment take page shows timer and progress', async ({ page }) => {
    // Mock assessment start
    await page.route('/api/assessments/start', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sessionId: 999997,
          skillName: 'React',
          question: {
            id: 20,
            text: 'What hook is used for side effects in React?',
            type: 'multiple_choice',
            options: ['useState', 'useEffect', 'useContext', 'useReducer'],
            timeLimit: 120,
            questionNumber: 1,
            totalQuestions: 10,
          },
        }),
      })
    })

    await page.goto('/candidate/assessments')
    await page.waitForTimeout(1000)

    const startBtn = page.getByRole('button', { name: /Start Test|Try Again|Retake/i }).first()
    await startBtn.click()

    await page.waitForURL(/.*\/candidate\/assessments\/\d+\/take/, { timeout: 10000 })
    await page.waitForTimeout(1000)

    // Verify progress bar
    await expect(page.locator('.h-2.rounded-full.bg-muted').first()).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.h-full.bg-primary').first()).toBeVisible()

    // Verify timer badge
    await expect(page.locator('text=/\\d+:\\d{2}/').first()).toBeVisible({ timeout: 10000 })

    // Verify question text
    await expect(page.getByText('What hook is used for side effects')).toBeVisible({ timeout: 15000 })

    // Verify all options are visible
    await expect(page.getByRole('button', { name: 'useState' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'useEffect' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'useContext' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'useReducer' }).first()).toBeVisible()
  })
})
