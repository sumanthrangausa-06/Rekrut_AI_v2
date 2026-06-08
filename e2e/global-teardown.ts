// Global teardown: kill any orphaned browser processes and clean temp dirs
import { execSync } from 'child_process'

export default async function globalTeardown() {
  // Playwright already closes its own browsers, but in CI environments
  // (especially Docker) orphaned headless shells can accumulate.
  // We kill a broad set of Chromium-related process names to be safe.
  const processNames = [
    'chrome',
    'chromium',
    'chrome-headless-shell',
  ]
  for (const name of processNames) {
    try {
      execSync(`pkill -f "${name}" 2>/dev/null || true`, { stdio: 'ignore' })
    } catch {
      // ignore — process may not exist
    }
  }
}
