# Train 8 patch manifest — cv-review v2.1 patch: #1476 extraction seam → staging (#1818)

**Relay — rider-clearing patch for cv-review v2.1 (Train 3, PR #1817; M1 prod, PR #1836).**
Registry rider on cv-review: "parse first-try reliability ~2/10 on staging — #1818".
Version stays cv-review v2.1 (patch-train precedent, PRs #1829/#1833).

## Root cause (first-hand, #1818 STOP 1 amendment, comment 6396541171)

The #1476 extraction fix (dev commit `724e1cd33`, PR #1483) never rode a train.
Staging and main/production trees have no `lib/pdf-extract.js`; all 3 extraction
sites call `pdfParse(buffer)` directly on the raw pooled multer/fs buffer.
pdf.js v1.10.100 misreads xref offsets for pooled slices at `byteOffset != 0`,
so valid PDFs fail intermittently with `bad XRef entry` (~2/10 first-try on
staging; the bug is live in production via M1).

## Picks (1, patch-id identical)

- `724e1cd33` (#1476, PR #1483) → `e3cc37281` — patch-id `62b703d3c38320929ef06432350a6ae03e950fe9` (identical)

Contents: new `lib/pdf-extract.js` (standalone Uint8Array copy seam) + the PDF
branches of `routes/candidate.js`, `routes/profile-enhancement.js`,
`services/document-verification.js` + corpus fixtures (F1–F7) + corpus suite.
After the pick, `lib/pdf-extract.js` is byte-identical to dev and no
pdf/parsePdf line in the 3 sites differs from dev. **No migrations. No new code**
— this is a promotion of an already-reviewed, dev-proven fix.

## Evidence (first-hand, train tree)

- `server/__tests__/lib/pdf-extract-1476.test.js`: **11/11 PASS** (real pdf-parse, no mocks; F7 corrupt PDF fails honestly).

## Retest plan (staging, after merge + deploy)

1. `/health` commit read-back matches the train merge.
2. First-try measurement through the real door: fresh candidate per attempt,
   `POST /api/candidate/profile/resume`, same test PDF family as Train 3's
   retest; record per-attempt `parsing_status`. Baseline 2/10; target ≥9/10.
3. On pass: registry close-out clearing the #1818 rider on cv-review.
4. Then a patch main train (staging → main) under the standing authorization,
   with prod `/health` + a small first-try measurement as the prod smoke.

**Do not merge until independent review approves.**
