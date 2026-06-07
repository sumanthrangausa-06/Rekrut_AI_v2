# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: navigation.spec.ts >> Navigation >> can navigate from home to login via nav link
- Location: e2e/navigation.spec.ts:4:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator:  locator('a[href="/login"]').first()
Expected: visible
Received: hidden
Timeout:  5000ms

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for locator('a[href="/login"]').first()
    11 × locator resolved to <a href="/login" data-discover="true">…</a>
       - unexpected value "hidden"

```

```yaml
- banner:
  - link "Rekrut AI logo Rekrut AI":
    - /url: /
    - img "Rekrut AI logo"
    - text: Rekrut AI
  - button "Open menu":
    - img
- main:
  - img
  - text: AI-powered career companion for candidates who want to get hired faster
  - heading "Your AI-Powered Career Companion" [level=1]
  - paragraph: Match with jobs that fit your skills. Practice interviews with AI. Get hired faster — no spam, no noise.
  - link "Get Started Free":
    - /url: /register
    - button "Get Started Free":
      - text: Get Started Free
      - img
  - link "See How It Works":
    - /url: /register?role=candidate
    - button "See How It Works"
  - paragraph: No credit card required. Free forever. Upgrade when you are ready.
  - img
  - text: Bank-grade security
  - img
  - text: In-house KYC
  - img
  - text: 50,000+ active candidates
  - img
  - text: AI-matched to real jobs
  - img
  - paragraph: Active Candidates
  - paragraph: 50,000+
  - img
  - paragraph: Open Positions
  - paragraph: 2,400+
  - img
  - paragraph: Avg. Match Score
  - paragraph: 87%
  - text: AI Matching Engine Active SR Senior React Developer at Stripe Top match 94% PM Product Manager at Netflix Strong fit 91% UD UX Designer at Airbnb Great fit 89%
  - paragraph: 50K+
  - paragraph: Active candidates
  - paragraph: 3x
  - paragraph: Better job matches
  - paragraph: 2 min
  - paragraph: Profile setup
  - paragraph: 94%
  - paragraph: Interview success rate
  - text: Features
  - heading "Everything you need to land your next job" [level=2]
  - paragraph: From AI matching to mock interviews to coaching — one platform, zero noise.
  - img
  - heading "AI Job Matching" [level=3]
  - paragraph: Upload your resume or build a profile. Our AI analyzes your skills, experience, and preferences — then surfaces roles where you have a real shot. Match score included so you know where you stand.
  - img
  - heading "Mock Interviews" [level=3]
  - paragraph: Practice unlimited mock interviews with our AI interviewer. Get real-time feedback on your answers, communication style, and pacing. Role-specific questions for tech, product, sales, marketing, and more.
  - img
  - heading "AI Coaching" [level=3]
  - paragraph: Stuck on salary negotiation? Need help with a career pivot? Our AI coaching gives you personalized, actionable advice based on your profile and goals. No appointments. No fees. Just ask.
  - img
  - heading "Skill Assessments" [level=3]
  - paragraph: Take AI-powered skill assessments that actually test your abilities, not your test-taking skills. Showcase verified skills to employers and stand out from the crowd.
  - img
  - heading "OmniScore" [level=3]
  - paragraph: Your OmniScore combines your skills, experience, assessments, and interview performance into one trusted metric. Employers see it. You own it. No more being reduced to a resume.
  - img
  - heading "Smart Applications" [level=3]
  - paragraph: One-click applications with AI-optimized cover letters tailored to each role. Track every application in one dashboard. Follow-up reminders so nothing falls through the cracks.
  - text: How it works
  - heading "From sign-up to hired in 3 steps" [level=2]
  - paragraph: No complex setup. Just a faster path to your next role.
  - img
  - text: "01"
  - heading "Build Your Profile" [level=3]
  - paragraph: Upload your resume or answer a few questions. Our AI extracts your skills, experience, and preferences automatically. Takes 2 minutes.
  - img
  - text: "02"
  - heading "Get Matched & Practice" [level=3]
  - paragraph: See your top job matches with match scores. Practice mock interviews for your target roles. Get coaching on your weak spots.
  - img
  - text: "03"
  - heading "Apply & Get Hired" [level=3]
  - paragraph: Apply with one click. Track your applications. Get feedback from employers. Land the job.
  - paragraph: Candidates at companies like Google, Stripe, Airbnb, and thousands of startups trust Rekrut AI
  - img
  - text: Google
  - img
  - text: Stripe
  - img
  - text: Airbnb
  - img
  - text: Netflix
  - img
  - text: Spotify
  - img
  - text: Shopify
  - img
  - text: Notion
  - img
  - text: Figma
  - img
  - img
  - img
  - img
  - img
  - paragraph: "\"I applied to 200 jobs manually and got 2 callbacks. Used Rekrut AI for 2 weeks, matched with 12 relevant roles, and got 3 offers.\""
  - text: SK
  - paragraph: Sarah K.
  - paragraph: Product Manager, hired at Stripe
  - img
  - img
  - img
  - img
  - img
  - paragraph: "\"The mock interviews caught me saying um 47 times and helped me fix my pacing. I crushed my real interview.\""
  - text: MT
  - paragraph: Marcus T.
  - paragraph: Software Engineer, hired at Netflix
  - img
  - img
  - img
  - img
  - img
  - paragraph: "\"OmniScore got me noticed by a recruiter who said they never would have found me through keyword search.\""
  - text: PR
  - paragraph: Priya R.
  - paragraph: Data Scientist, hired at Airbnb
  - img
  - img
  - img
  - img
  - img
  - paragraph: "\"As a career switcher, I had no idea how to position myself. The AI coaching gave me a roadmap and the confidence to negotiate a $30K higher salary.\""
  - text: JL
  - paragraph: James L.
  - paragraph: Former Teacher → UX Designer
  - text: Pricing
  - heading "Start free. Upgrade when you are ready." [level=2]
  - paragraph: No hidden fees, no long-term contracts. Free forever. Pro when you need more power.
  - heading "Free" [level=3]
  - paragraph: For individuals getting started.
  - text: $0/month
  - list:
    - listitem:
      - img
      - text: AI job matching (up to 20 matches/day)
    - listitem:
      - img
      - text: 3 mock interviews per month
    - listitem:
      - img
      - text: Basic skill assessments
    - listitem:
      - img
      - text: Standard application tracking
    - listitem:
      - img
      - text: AI coaching (limited)
  - link "Get started free":
    - /url: /register
    - button "Get started free"
  - text: Most popular
  - heading "Pro" [level=3]
  - paragraph: For candidates who want unlimited everything.
  - text: $19/month
  - paragraph: $149/year (2 months free)
  - list:
    - listitem:
      - img
      - text: "Everything in Free, plus:"
    - listitem:
      - img
      - text: Unlimited AI job matching
    - listitem:
      - img
      - text: Unlimited mock interviews
    - listitem:
      - img
      - text: Advanced skill assessments + OmniScore
    - listitem:
      - img
      - text: AI coaching (unlimited)
    - listitem:
      - img
      - text: Priority application boosting
    - listitem:
      - img
      - text: Resume & cover letter AI optimizer
  - link "Start Pro trial":
    - /url: /register
    - button "Start Pro trial":
      - text: Start Pro trial
      - img
  - heading "Teams" [level=3]
  - paragraph: For employers hiring at scale.
  - text: Custom
  - list:
    - listitem:
      - img
      - text: "Everything in Pro, plus:"
    - listitem:
      - img
      - text: Post jobs to candidate marketplace
    - listitem:
      - img
      - text: AI candidate sourcing & screening
    - listitem:
      - img
      - text: Interview scheduling & analytics
    - listitem:
      - img
      - text: Dedicated account manager
  - link "Contact sales":
    - /url: /contact
    - button "Contact sales"
  - paragraph: Stripe checkout launching in ~1 week. Until then, Pro features available via free trial. No credit card required.
  - link "View full pricing details":
    - /url: /pricing
    - button "View full pricing details":
      - text: View full pricing details
      - img
  - text: Security & Trust
  - heading "Your data is yours. Period." [level=2]
  - paragraph: We built everything in-house. No third-party vendors. No data selling. No compromises.
  - img
  - heading "In-House KYC" [level=3]
  - paragraph: We verify identity ourselves — no third-party vendors, no data sharing. Your documents stay in our encrypted vault.
  - img
  - heading "Bank-Grade Encryption" [level=3]
  - paragraph: AES-256 encryption at rest, TLS 1.3 in transit. Your data is locked down like a bank vault.
  - img
  - heading "Zero Data Selling" [level=3]
  - paragraph: We do not sell your profile to recruiters. We do not monetize your data. We make money when you upgrade — that is it.
  - img
  - heading "GDPR & CCPA Compliant" [level=3]
  - paragraph: Full data export, deletion, and portability. You control your information. SOC 2 Type II in progress.
  - text: FAQ
  - heading "Frequently asked questions" [level=2]
  - paragraph:
    - text: Everything you need to know about Rekrut AI. Can not find what you are looking for?
    - link "Contact us":
      - /url: /contact
    - text: .
  - button "Is Rekrut AI really free?":
    - text: Is Rekrut AI really free?
    - img
  - paragraph: Yes. The free tier gives you job matching, limited mock interviews, and basic assessments. No credit card required. No time limit. Pro unlocks unlimited everything.
  - button "How is your AI matching different from LinkedIn or Indeed?":
    - text: How is your AI matching different from LinkedIn or Indeed?
    - img
  - button "Who sees my profile?":
    - text: Who sees my profile?
    - img
  - button "Is my data secure?":
    - text: Is my data secure?
    - img
  - button "What is OmniScore?":
    - text: What is OmniScore?
    - img
  - button "When will Pro billing be available?":
    - text: When will Pro billing be available?
    - img
  - button "Can employers reach out to me?":
    - text: Can employers reach out to me?
    - img
  - button "What industries do you cover?":
    - text: What industries do you cover?
    - img
  - heading "Stop applying to black holes. Start getting matched." [level=2]
  - paragraph: Join 50,000+ candidates using AI to find their next job. Free forever. No spam. No noise.
  - link "Get Started Free — 2 Minutes":
    - /url: /register
    - button "Get Started Free — 2 Minutes":
      - text: Get Started Free — 2 Minutes
      - img
  - link "See Pricing":
    - /url: /pricing
    - button "See Pricing"
- contentinfo:
  - link "Rekrut AI logo Rekrut AI":
    - /url: /
    - img "Rekrut AI logo"
    - text: Rekrut AI
  - paragraph: AI-native recruitment platform connecting candidates and recruiters. Built in 2026 by Ranga Sumanth and Suga. Hiring smarter, faster, and more transparently.
  - link:
    - /url: https://twitter.com/rekrutai
    - img
  - link:
    - /url: https://linkedin.com/company/rekrutai
    - img
  - link:
    - /url: https://github.com/rekrutai
    - img
  - link:
    - /url: mailto:hello@rekrutai.co
    - img
  - heading "Product" [level=4]
  - list:
    - listitem:
      - link "Features":
        - /url: /#features
    - listitem:
      - link "Pricing":
        - /url: /pricing
    - listitem:
      - link "AI Matching":
        - /url: /#features
    - listitem:
      - link "OmniScore":
        - /url: /#features
    - listitem:
      - link "Video Interviews":
        - /url: /#features
  - heading "Company" [level=4]
  - list:
    - listitem:
      - link "About us":
        - /url: /about
    - listitem:
      - link "Blog":
        - /url: /blog
    - listitem:
      - link "Careers":
        - /url: /contact
    - listitem:
      - link "Contact":
        - /url: /contact
  - heading "Resources" [level=4]
  - list:
    - listitem:
      - link "Help Center":
        - /url: /contact
    - listitem:
      - link "API Docs":
        - /url: /contact
    - listitem:
      - link "Status":
        - /url: /contact
  - heading "Legal" [level=4]
  - list:
    - listitem:
      - link "Privacy Policy":
        - /url: /privacy
    - listitem:
      - link "Terms of Service":
        - /url: /terms
    - listitem:
      - link "Cookie Policy":
        - /url: /privacy
  - paragraph: © 2026 Rekrut AI (formerly HireLoop). All rights reserved.
  - img
  - text: Made with care in India. Hiring globally.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test'
  2  | 
  3  | test.describe('Navigation', () => {
  4  |   test('can navigate from home to login via nav link', async ({ page }) => {
  5  |     await page.goto('/')
  6  |     const loginLink = page.locator('a[href="/login"]').first()
> 7  |     await expect(loginLink).toBeVisible()
     |                             ^ Error: expect(locator).toBeVisible() failed
  8  |     await loginLink.click()
  9  |     await expect(page).toHaveURL(/.*\/login/)
  10 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  11 |   })
  12 | 
  13 |   test('can navigate from home to register via nav link', async ({ page }) => {
  14 |     await page.goto('/')
  15 |     const registerLink = page.locator('a[href="/register"]').first()
  16 |     await expect(registerLink).toBeVisible()
  17 |     await registerLink.click()
  18 |     await expect(page).toHaveURL(/.*\/register/)
  19 |   })
  20 | 
  21 |   test('can navigate from home to pricing page', async ({ page }) => {
  22 |     await page.goto('/')
  23 |     const pricingLink = page.locator('a[href="/pricing"]').first()
  24 |     await expect(pricingLink).toBeVisible()
  25 |     await pricingLink.click()
  26 |     await expect(page).toHaveURL(/.*\/pricing/)
  27 |   })
  28 | 
  29 |   test('can navigate from login to register via link', async ({ page }) => {
  30 |     await page.goto('/login')
  31 |     const registerLink = page.locator('a[href="/register"]').first()
  32 |     await expect(registerLink).toBeVisible()
  33 |     await registerLink.click()
  34 |     await expect(page).toHaveURL(/.*\/register/)
  35 |   })
  36 | 
  37 |   test('can navigate from register to login via link', async ({ page }) => {
  38 |     await page.goto('/register')
  39 |     const loginLink = page.locator('a[href="/login"]').first()
  40 |     await expect(loginLink).toBeVisible()
  41 |     await loginLink.click()
  42 |     await expect(page).toHaveURL(/.*\/login/)
  43 |     await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  44 |   })
  45 | 
  46 |   test('logo on home page links to home', async ({ page }) => {
  47 |     await page.goto('/')
  48 |     const logo = page.locator('a:has-text("Rekrut AI")').first()
  49 |     await expect(logo).toBeVisible()
  50 |   })
  51 | })
  52 | 
```