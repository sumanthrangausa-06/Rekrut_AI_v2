**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**This may already be done. Measure before starting any implementation.**

`origin/dev` already has both halves of a normal code-splitting setup:

- `client/src/App.tsx` uses **86 `lazy()` route imports** behind a `Suspense` boundary, so routes are split.
- `client/vite.config.ts` defines `manualChunks` splitting `react`, `react-dom`, `react-router`, `lucide-react` and a `vendor` catch-all, with `chunkSizeWarningLimit` set to 600.

The 1.55MB figure in the title predates this work. **The first action should be a production build to measure the actual main chunk**, not adding splitting that is already there.

If the main chunk is within budget, close this issue. If it is not, retitle it around whatever is genuinely still heavy.

```bash
cd client && npm run build
```
