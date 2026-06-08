// Global teardown: kill any orphaned browser processes and clean temp dirs
import { execSync } from 'child_process'

export default async function globalTeardown() {
  // Playwright already closes its own browsers, but in CI environments
  // (especially Docker) orphaned headless shells can accumulate.
  try {
    execSync('pkill -f "chrome-headless-shell" 2>/dev/null || true', { stdio: 'ignore' })
  } catch {
    // ignore — process may not exist
  }
}
