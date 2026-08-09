**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

Note: #62 covers this same scope and was closed as completed on 2026-08-06, but this audit found no supporting code.

`git grep -i "swagger|openapi"` against `origin/dev` returns nothing outside of documentation and issue scaffolding. There is no spec file, no generator step, and no route serving API docs.

Treat this issue as the real remaining work, not a duplicate of something already delivered.
