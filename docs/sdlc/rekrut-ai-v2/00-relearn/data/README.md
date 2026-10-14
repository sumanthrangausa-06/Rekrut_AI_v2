# Data Documentation Pack — Rekrut_AI_v2

**Purpose:** the data layer of the application, documented for future use and for building on it. Written for builders: every factual claim is verified against `origin/dev` (commit `e5599900`, 2026-10-13) with file:line or migration-number citations, and anything that could not be verified is marked **NOT VERIFIED** rather than filled in.

**Owners:** Scout (extraction), Rex (model & architecture), Quinn (seed data), Lead (filing), Lex (erasure keep/erase table).

| Doc | What it answers |
|-----|-----------------|
| [data-model.md](./data-model.md) | What are the entities, who owns them (candidate / company / joint / platform), how do they relate (ER diagram), and what is each entity's lifecycle — creation, retention, erasure, legal hold? Includes the identity & account model. |
| [schema.md](./schema.md) | What does the database actually look like as-is — every table, column, type, key, constraint, index (239 tables, migration-derived)? |
| [migrations.md](./migrations.md) | How did the schema get here — full migration inventory (001–258), how migrations run at deploy, what is deploy-pending (252–258), how to add one, and the known fresh-database defect at migration 238 (#894). |
| [rls-policies.md](./rls-policies.md) | How is data access actually controlled? **There is no Postgres RLS** — this doc is the truth about the application-layer enforcement that exists instead, with the patterns new code must copy. |
| [seed-data.md](./seed-data.md) | What seed/fixture data exists, the test-account policy (#151, #336), what must never be seeded, and how a builder gets a working local dataset. |
| [data-model-simplification-assessment.md](./data-model-simplification-assessment.md) | Is the model too complex, and how does it get simpler? The target simplified model (canonical home per concept, ≈212–216 tables from 239), the anti-accretion conventions that keep it simple, graded candidates with safe migration paths and the proof standard before any drop, and pre/post-launch sequencing. Assessment only — nothing filed or changed. |
| [erasure-keep-erase-table.md](./erasure-keep-erase-table.md) | **Owner: Lex.** The formal compliance disposition for candidate data on erasure — what MUST ERASE, what MAY KEEP (with basis, named fields, and a retention clock), the audit verdict per line, and the GAP register (#1120–#1129). Any feature that stores candidate data must be classified here. |

**Reading order for a new builder:** data-model → schema → rls-policies → migrations → seed-data. Anyone adding or changing a store of candidate data must also read the erasure keep/erase table.

**Standing caveats (all detailed inside the docs):** no live-database introspection was possible from the build environment, so schema truth is migration-derived and live-DB drift is possible; migrations 252–258 have not run anywhere yet; a fresh database cannot currently be built past migration 238 (#894).
