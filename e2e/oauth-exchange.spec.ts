/**
 * OAuth one-time exchange code — E2E regression test.
 *
 * This is the exact test whose absence caused the OAuth saga: "OAuth callback
 * → app boot → authenticated user" was never automated, so five production
 * PRs shipped without anyone verifying the dashboard renders authenticated.
 *
 * What it tests (frontend flow): landing on {dest}?oauth_code=<code> trades
 * the code via POST /api/auth/oauth/exchange, stores tokens in localStorage,
 * strips the code from the URL, boots authenticated, and does NOT bounce to
 * /login. An invalid code falls back to the normal /login bounce.
 *
 * What it does NOT test: the real backend exchange endpoint — that contract
 * is pinned by server/__tests__/routes/oauth-exchange.test.js (real SQL via
 * pg-mem, full server.js wiring incl. the CSRF exemption). Here a minimal
 * stub implements the same contract so the frontend flow runs standalone.
 *
 * Prerequisite: the client must be built (`npm run build` in client/) — the
 * spec serves client/dist over HTTP like production does.
 */
import { test, expect } from '@playwright/test'
import express from 'express'
import path from 'path'
import type { Server } from 'http'

const STUB_PORT = 3100
const BASE = `http://localhost:${STUB_PORT}`
const VALID_CODE = 'e2e-valid-oauth-code'
const ACCESS_TOKEN = 'e2e-oauth-access-token'

let server: Server

test.beforeAll(async () => {
  const app = express()
  app.use(express.json())

  // Stub of POST /api/auth/oauth/exchange — same contract as the real endpoint
  app.post('/api/auth/oauth/exchange', (req, res) => {
    if (req.body?.code === VALID_CODE) {
      return res.json({
        accessToken: ACCESS_TOKEN,
        refreshToken: 'e2e-oauth-refresh-token',
        dest: '/candidate',
      })
    }
    return res.status(410).json({ error: 'Invalid or expired code' })
  })

  // Stub of GET /api/auth/me — accepts only the exchanged token
  app.get('/api/auth/me', (req, res) => {
    if (req.headers.authorization === `Bearer ${ACCESS_TOKEN}`) {
      return res.json({
        user: {
          id: 1,
          email: 'e2e-oauth@rekrutai.test',
          name: 'E2E OAuth',
          role: 'candidate',
        },
      })
    }
    return res.status(401).json({ error: 'Authentication required' })
  })

  // Quiet the non-blocking background calls the bootstrap makes
  app.get('/api/billing/tier', (_req, res) => res.json({ tier: 'free' }))

  // Serve the built SPA with index.html fallback (client-side routing)
  const dist = path.resolve(__dirname, '../client/dist')
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))

  await new Promise<void>((resolve) => {
    server = app.listen(STUB_PORT, resolve)
  })
})

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  )
})

test.describe('OAuth one-time code landing', () => {
  test('valid code boots the app authenticated (the original bounce)', async ({ page }) => {
    await page.goto(`${BASE}/candidate?oauth_code=${VALID_CODE}`)

    // Dashboard renders authenticated — not bounced to /login
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/candidate/)

    // The single-use code is stripped from the URL after exchange
    await expect(page).not.toHaveURL(/oauth_code/)

    // Tokens landed in localStorage (the SPA's credential store)
    const token = await page.evaluate(() => localStorage.getItem('rekrutai_token'))
    expect(token).toBe(ACCESS_TOKEN)

    // Survives a reload (proves the token — not the code — sustains the session)
    await page.reload()
    await expect(page.locator('text=Dashboard').first()).toBeVisible({ timeout: 15000 })
    await expect(page).toHaveURL(/\/candidate/)
  })

  test('invalid code falls back to the login bounce', async ({ page }) => {
    await page.goto(`${BASE}/candidate?oauth_code=bogus-code`)

    await expect(page).toHaveURL(/\/login/, { timeout: 15000 })
    await expect(page).not.toHaveURL(/oauth_code/)

    const token = await page.evaluate(() => localStorage.getItem('rekrutai_token'))
    expect(token).toBeNull()
  })
})
