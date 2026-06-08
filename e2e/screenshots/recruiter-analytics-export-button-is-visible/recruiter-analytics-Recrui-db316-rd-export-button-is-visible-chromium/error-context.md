# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: recruiter-analytics.spec.ts >> Recruiter Analytics Dashboard >> export button is visible
- Location: e2e/recruiter-analytics.spec.ts:116:7

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /Export/i })
Expected: visible
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByRole('button', { name: /Export/i })
    - waiting for" http://localhost:3000/login" navigation to finish...
    - navigated to "http://localhost:3000/login"

```

```yaml
- link "Rekrut AI logo Rekrut AI":
  - /url: /
  - img "Rekrut AI logo"
  - text: Rekrut AI
- paragraph:
  - text: Don't have an account?
  - link "Sign up":
    - /url: /register
- button "Toggle theme":
  - img
- heading "Sign in" [level=2]
- text: Email
- textbox "Email":
  - /placeholder: example.email@gmail.com
- text: Password
- textbox "Password":
  - /placeholder: Enter at least 8+ characters
- button "Show password":
  - img
- checkbox "Remember me"
- text: Remember me
- link "Forgot password?":
  - /url: /forgot-password
- button "Sign in":
  - img
  - text: Sign in
- img
- heading "Welcome back!" [level=3]
- paragraph: Sign in to access your dashboard, track applications, and continue your interview practice.
```

# Test source

```ts
  21  |   })
  22  | 
  23  |   test('hiring funnel renders with stages', async ({ page }) => {
  24  |     await page.goto('/recruiter/analytics')
  25  |     await page.waitForLoadState('networkidle')
  26  | 
  27  |     await expect(page.getByRole('heading', { name: /Hiring Funnel/i })).toBeVisible({ timeout: 10000 })
  28  | 
  29  |     // Verify funnel stages are visible
  30  |     const funnelStages = ['Job Views', 'Applied', 'Screened', 'Interviewed', 'Offered', 'Hired']
  31  |     for (const stage of funnelStages) {
  32  |       await expect(page.locator('text=' + stage).first()).toBeVisible()
  33  |     }
  34  |   })
  35  | 
  36  |   test('hiring velocity chart renders with data', async ({ page }) => {
  37  |     await page.goto('/recruiter/analytics')
  38  |     await page.waitForLoadState('networkidle')
  39  | 
  40  |     await expect(page.getByRole('heading', { name: /Hiring Velocity/i })).toBeVisible({ timeout: 10000 })
  41  | 
  42  |     // Verify at least one month bar is visible (mock data includes Jan-Jun)
  43  |     await expect(page.locator('text=Jan').first()).toBeVisible()
  44  |     await expect(page.locator('text=Applications').first()).toBeVisible()
  45  |     await expect(page.locator('text=Hired').first()).toBeVisible()
  46  |   })
  47  | 
  48  |   test('application sources breakdown renders', async ({ page }) => {
  49  |     await page.goto('/recruiter/analytics')
  50  |     await page.waitForLoadState('networkidle')
  51  | 
  52  |     await expect(page.getByRole('heading', { name: /Application Sources/i })).toBeVisible({ timeout: 10000 })
  53  | 
  54  |     const sources = ['Direct', 'LinkedIn', 'Indeed', 'Referral']
  55  |     for (const source of sources) {
  56  |       await expect(page.locator('text=' + source).first()).toBeVisible()
  57  |     }
  58  |   })
  59  | 
  60  |   test('time to hire by stage renders', async ({ page }) => {
  61  |     await page.goto('/recruiter/analytics')
  62  |     await page.waitForLoadState('networkidle')
  63  | 
  64  |     await expect(page.getByRole('heading', { name: /Time to Hire by Stage/i })).toBeVisible({ timeout: 10000 })
  65  | 
  66  |     // Verify at least one stage row is visible
  67  |     await expect(page.locator('text=days avg').first()).toBeVisible()
  68  |   })
  69  | 
  70  |   test('OmniScore distribution renders', async ({ page }) => {
  71  |     await page.goto('/recruiter/analytics')
  72  |     await page.waitForLoadState('networkidle')
  73  | 
  74  |     await expect(page.getByRole('heading', { name: /Candidate Quality/i })).toBeVisible({ timeout: 10000 })
  75  | 
  76  |     const scoreRanges = ['900+', '800-899', '700-799', '600-699', '<600']
  77  |     for (const range of scoreRanges) {
  78  |       await expect(page.locator('text=' + range).first()).toBeVisible()
  79  |     }
  80  |   })
  81  | 
  82  |   test('time range filter changes data', async ({ page }) => {
  83  |     await page.goto('/recruiter/analytics')
  84  |     await page.waitForLoadState('networkidle')
  85  | 
  86  |     const timeRangeSelect = page.locator('select').first()
  87  |     await expect(timeRangeSelect).toBeVisible()
  88  | 
  89  |     // Change to 7 days
  90  |     await timeRangeSelect.selectOption('7')
  91  |     await page.waitForLoadState('networkidle')
  92  | 
  93  |     // Verify dashboard still loads after filter change
  94  |     await expect(page.getByRole('heading', { name: /Hiring Analytics/i })).toBeVisible({ timeout: 10000 })
  95  |     await expect(page.locator('text=Job Views').first()).toBeVisible()
  96  | 
  97  |     // Change to 90 days
  98  |     await timeRangeSelect.selectOption('90')
  99  |     await page.waitForLoadState('networkidle')
  100 |     await expect(page.locator('text=Applications').first()).toBeVisible()
  101 |   })
  102 | 
  103 |   test('advanced metrics section renders for Pro tier', async ({ page }) => {
  104 |     await page.goto('/recruiter/analytics')
  105 |     await page.waitForLoadState('networkidle')
  106 | 
  107 |     await expect(page.getByRole('heading', { name: /Advanced Metrics/i })).toBeVisible({ timeout: 10000 })
  108 |     await expect(page.locator('text=Pro').first()).toBeVisible()
  109 | 
  110 |     // Verify metric cards
  111 |     await expect(page.locator('text=Cost per Hire').first()).toBeVisible()
  112 |     await expect(page.locator('text=Quality of Hire').first()).toBeVisible()
  113 |     await expect(page.locator('text=Offer Acceptance').first()).toBeVisible()
  114 |   })
  115 | 
  116 |   test('export button is visible', async ({ page }) => {
  117 |     await page.goto('/recruiter/analytics')
  118 |     await page.waitForLoadState('networkidle')
  119 | 
  120 |     const exportBtn = page.getByRole('button', { name: /Export/i })
> 121 |     await expect(exportBtn).toBeVisible()
      |                             ^ Error: expect(locator).toBeVisible() failed
  122 |   })
  123 | })
  124 | 
```