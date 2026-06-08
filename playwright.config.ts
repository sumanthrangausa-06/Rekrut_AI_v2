import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',

  // Run tests in files sequentially, not in parallel. Each file still gets
  // its own worker, but tests within a file run one after another.
  // This prevents memory spikes from many concurrent browser contexts.
  fullyParallel: false,

  // Fail fast — don't keep spawning browsers if the app is broken
  maxFailures: 5,

  // Explicit timeout: 60s per test (Playwright default is 30s)
  timeout: 60000,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // Cap workers at 1 to limit total browser processes in memory.
  // Each worker can hold one or more browser contexts.
  // On this machine (7 GB RAM) 1 worker × 1 project = ~1 concurrent
  // browser instance max, which is safe.
  workers: 1,

  reporter: 'list',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',

    // Reduce browser memory footprint by disabling unnecessary features
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI,IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--enable-features=NetworkService,NetworkServiceInProcess',
        '--force-color-profile=srgb',
        '--mute-audio',
        '--no-first-run',
        '--disk-cache-dir=/tmp/playwright-cache',
        '--js-flags=--max-old-space-size=512',
        '--disable-extensions',
        '--disable-default-apps',
        '--disable-background-networking',
      ],
    },
  },

  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      timeout: 180000, // 3 min — allows for rate-limit retries
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Reuse browser context storage state for auth-dependent tests
      },
      dependencies: ['setup'],
    },
    // Mobile project is commented out by default for the full suite to avoid
    // SIGKILL. It can be run separately:
    //   npx playwright test --project=mobile-chromium
    //
    // {
    //   name: 'mobile-chromium',
    //   use: {
    //     ...devices['iPhone 14'],
    //     browserName: 'chromium',
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  // Global teardown: disabled — the pkill-based teardown was killing Playwright's
  // own browser before it could finish graceful shutdown, causing the test runner
  // to hang and receive SIGTERM. Playwright's built-in cleanup is sufficient for
  // per-file test runs.
  // globalTeardown: require.resolve('./e2e/global-teardown.ts'),

  webServer: {
    command: 'node server.js',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
