**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

Note: #60 covers this same scope and was closed as completed on 2026-08-06, but this audit found no supporting code.

`package.json` on `origin/dev` contains no load-testing dependency: no k6, artillery, autocannon or clinic. The only grep hits were binary Playwright artifacts under `client/test-results/`.

Treat this issue as the real remaining work. It also matters more than its priority suggests, because the code sandbox in #117 will need a load profile before it is exposed publicly.
