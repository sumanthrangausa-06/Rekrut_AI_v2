#!/usr/bin/env node
/**
 * Sequential E2E Test Runner for Rekrut AI
 *
 * Problem: Running the full Playwright suite concurrently causes SIGKILL
 * due to browser process accumulation. Each test file in Playwright gets
 * its own worker even with workers: 1, and browsers can accumulate
 * across files if the webServer is also spawning node processes.
 *
 * Solution: Run each spec file sequentially in a single Node process,
 * with explicit cleanup between files. This limits the maximum number
 * of concurrent browser instances to exactly what one Playwright worker
 * uses (typically 1 context + 1 page).
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const E2E_DIR = path.join(__dirname, '..', 'e2e')
const REPORT_DIR = path.join(__dirname, '..', 'e2e-reports')

const IGNORED_PATTERNS = [
  'auth.setup.ts',
  'global-teardown.ts',
  'helpers.ts',
  'results.md',
  'verification-summary.md',
  'mobile-responsive-fixes.md',
]

const MOBILE_PROJECT = process.argv.includes('--mobile') ? 'mobile-chromium' : 'chromium'

function getSpecFiles() {
  const files = fs
    .readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts') && !IGNORED_PATTERNS.includes(f))
    .sort()
  return files
}

function killOrphanedBrowsers() {
  try {
    execSync('pkill -f "chrome-headless-shell" 2>/dev/null || true', { stdio: 'ignore' })
    execSync('pkill -f "Chromium" 2>/dev/null || true', { stdio: 'ignore' })
  } catch {
    // ignore
  }
}

function runSingleSpec(fileName) {
  const specPath = path.join(E2E_DIR, fileName)
  const reportPrefix = fileName.replace('.spec.ts', '')
  const reportFile = path.join(REPORT_DIR, `${reportPrefix}.json`)

  if (!fs.existsSync(REPORT_DIR)) {
    fs.mkdirSync(REPORT_DIR, { recursive: true })
  }

  const cmd = [
    'npx',
    'playwright',
    'test',
    `"${specPath}"`,
    '--project=' + MOBILE_PROJECT,
    '--reporter=json',
    `--output=${path.join(REPORT_DIR, reportPrefix)}`,
  ]

  // Append any extra args passed after the script name (except --mobile)
  const extraArgs = process.argv.slice(2).filter((a) => a !== '--mobile')
  cmd.push(...extraArgs)

  const cmdStr = cmd.join(' ')
  console.log(`\n▶ Running ${fileName}…`)
  console.log(`  ${cmdStr}`)

  const start = Date.now()
  let status = 'PASS'
  let error = null

  try {
    execSync(cmdStr, {
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      timeout: 180000, // 3 minutes per spec file
      env: {
        ...process.env,
        // Force single worker even if config is overridden
        PLAYWRIGHT_WORKERS: '1',
      },
    })
  } catch (err) {
    status = 'FAIL'
    error = err.message
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  return {
    file: fileName,
    status,
    elapsed: `${elapsed}s`,
    error,
  }
}

function main() {
  const specFiles = getSpecFiles()

  if (specFiles.length === 0) {
    console.error('No .spec.ts files found in', E2E_DIR)
    process.exit(1)
  }

  console.log(`Sequential E2E Runner — ${specFiles.length} spec files found`)
  console.log(`Project: ${MOBILE_PROJECT}`)
  console.log('─'.repeat(60))

  const results = []
  let passed = 0
  let failed = 0

  for (const file of specFiles) {
    // Cleanup before each spec to prevent memory accumulation
    killOrphanedBrowsers()

    const result = runSingleSpec(file)
    results.push(result)

    if (result.status === 'PASS') {
      passed++
      console.log(`✅ ${file} — ${result.elapsed}`)
    } else {
      failed++
      console.log(`❌ ${file} — ${result.elapsed}`)
      if (result.error) {
        console.log(`   Error: ${result.error}`)
      }
    }
  }

  // Final cleanup
  killOrphanedBrowsers()

  console.log('\n' + '═'.repeat(60))
  console.log('Results Summary')
  console.log('═'.repeat(60))
  for (const r of results) {
    const icon = r.status === 'PASS' ? '✅' : '❌'
    console.log(`${icon} ${r.file.padEnd(40)} ${r.status}  ${r.elapsed}`)
  }
  console.log('─'.repeat(60))
  console.log(`Total: ${specFiles.length} | Passed: ${passed} | Failed: ${failed}`)

  if (failed > 0) {
    console.log('\n⚠️  Some tests failed. See output above for details.')
    process.exit(1)
  } else {
    console.log('\n🎉 All tests passed!')
    process.exit(0)
  }
}

main()
