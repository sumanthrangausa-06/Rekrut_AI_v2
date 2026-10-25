---
project: Unified Interview Engine
phase: 1-Analysis
type: decision-brief
gate: Gate A — E-004/E-005 launch scope
issues: 634 (E-004), 635 (E-005), 697 (S-049b), 787 (S-085)
status: awaiting Sumanth's decision
created: 2026-10-12
owner: Lead (Sprint Planning)
evidence: S-082 audit spike (#782) — Rex, Scout-verified against dev @ 6c26ec63
---

# Gate A Brief — Are E-004/E-005 Launch Scope?

**Date:** 2026-10-12
**Author:** Lead (reporting to Suga, CTO)
**Status:** Decision brief — **binding decision required from Sumanth before Sprint 11 planning**
**Evidence:** `s082-audit-spike.md` (same folder) — every figure below is from the spike's code-verified re-size; ranges are the spike's own ranges.

> **The decision:** does the January launch include real Observer analysis (integrity + behavioural signals in human-interview reports), or does the Observer ship as presence-only — toggle, consent, disclosure, report shell — with analysis sections honestly reading "Insufficient data"?

---

## 1. The price was wrong — here is the verified one

The "~80 pts" figure is the accurate sum of the **wrong unit**. It prices two full epics across *all* interview surfaces:

| Scope | Points | What it is |
|---|---:|---|
| Filed E-004 + E-005 | 80 (57 + 23) | Includes **39 pts of AI-interview machinery the Observer never uses** (client-side signals, deepfake/liveness challenges, interactive probing, rPPG) |
| Full Phase-3 vision | **94** | The 80 + E-003 calibration (14), which S-027/S-028 formally depend on — the 80 was never the whole price even on its own terms |
| **Observer path (what S-049b actually needs)** | **≈ 40–48** | Substrate + S-029 + S-021 slice + E-005 core + S-027 fusion + S-049b completion |
| Observer path, fully loaded | ≈ 50–58 | Adds S-028 (voice consistency) + S-033 (linguistic) — valuable, not required for v1 |

**🔴 The missing piece:** 8–13 of those points are a **capture substrate that exists in no filed story** (now filed as **S-085, #787**). The S-047 worker subscribes to LiveKit tracks but consumes no media — no track handler, no storage, no transcription. Every E-004/E-005 story assumed capture exists; it does not. The substrate is also the privacy-critical layer — the first persistence of raw biometric media — and carries its own mandatory privacy-engineer review.

**Reusability is closed:** none of `interview-ai.js`'s exports transfer (wrong input type — transcript judgments, not signals). Only plumbing is reused (`ai-provider.js` + ASR cascade, `r2FrameStore` pattern), already reflected in the substrate range. No option gets cheaper via "reuse." Legacy length-based fallbacks in that file **fabricate scores** — S-049b must not inherit them.

## 2. The options

| Option | Cost | What ships in January |
|---|---|---|
| **A — Observer path IN** | **≈ 40–48 pts** (50–58 fully loaded) | Full Observer analysis: capture substrate (S-085) → S-029 events layer + S-021 baselines → E-005 core (vocal/visual/multimodal) → S-027 fusion → S-049b populated reports. Integrity events listed for human review; no autonomous verdicts; no fabricated scores |
| **B — Observer path OUT (defer)** | **0 pts** | Observer stays presence-only. S-039 reports render Observer sections as "Insufficient data / N/A" — defined, honest behaviour. S-049b and the chain stay parked, fully resumable post-launch |
| **C — Partial: behaviour without integrity fusion** | **≈ 26–33 pts** (summed from spike §2.2 components: substrate 8–13 + E-005 core 15 + S-049b 3–5) | Capture + vocal/visual measurement populate report sections; S-027 fusion, S-029, and baselines deferred — `integrity_summary` stays honestly `missing`. Buys behavioural differentiation now; integrity becomes a post-launch follow-on, not a rebuild |

## 3. Deferral verdict (spike §3 — Rex, Scout-verified)

**Deferral is safe, fully reversible, and privacy-optimal.** Today the worker consumes, records, and analyzes **zero** media — there is no biometric processing to create compliance exposure, and nothing accumulates, so there is **no catch-up debt**: the day the pipeline lands, subsequent sessions populate. Option B's cost is **differentiation only** — recruiters see an honest empty Observer column, and the human interviewer remains the primary channel by design. The risky order would be the reverse (capture before analysis = stored raw biometric media with no consumer). No mitigation plan is needed for deferral.

## 4. Watch-item (not a blocker)

Candidate-facing copy must never promise analysis that doesn't run. The S-048 disclosure copy is privacy-reviewed and S-039's honest rendering is defined behaviour; the open item is **#777** — the biometric policy page promises the unbuilt E-003 calibration baseline. It sits on the pre-launch track under **every** option above (only Option A with full E-003 — outside all three options at +14 — would make it true). Copy alignment is a pre-launch review task, not engineering.

## 5. What the decision unlocks

- **A or C:** S-085 enters Sprint 11 planning as the chain's first story (privacy-engineer review mandatory); S-049b unblocks behind it.
- **B:** Sprint 11 plans without the chain; the Gate A question does not reopen unless Sumanth reopens it — the spike's evidence stands.
- **Either way:** the AI-surface anti-cheat remainder (~39 pts) is a **separate product bet** about AI-led interviews, decided on its own module sequencing — it is not part of this gate.

**Decision recorded on:** #634 (this brief) and #697. **Needed:** Sumanth's ruling — A, B, or C — before Sprint 11 planning begins.

---

*— Lead, Sprint Planning. Evidence: S-082 spike (#782, Rex + Scout). This brief presents options; the decision is Sumanth's.*
