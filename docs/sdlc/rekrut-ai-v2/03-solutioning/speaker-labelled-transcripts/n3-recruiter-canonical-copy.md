---
project: Speaker-Labelled Interview Transcripts (Diarization) — BR-7 N-3 Recruiter Onboarding/Setup Canonical Copy
version: 1
status: canonical copy — Lex (authorship); advance notice only (§4.5), supplementary to own-screen delivery
created: 2026-10-29
owner: Sumanth
author: Lex (Legal & Compliance persona)
issue: "#1958 — [STORY] S-D21: BR-7 N-3 artefacts (parent #1952, epic #1900)"
design: br7-panel-notice-design.md §11 item 2 + §4.5 (this folder)
gate_basis: "Wording verified against the shipped gate on dev @ 6ac9c15eb — lib/diarizationGate.js panel leg (S-D19, PR #1963); see §4 of this artefact."
specialist_reviews:
  - "agency-agents/engineering-privacy-engineer — MANDATORY (design §15): ACCEPT-WITH-CONDITIONS, no BLOCK. Condition C-4 fell on this artefact (§3 short form said 'every participant', which could be read as requiring the candidate to also give a panel agreement — the candidate is excluded from the panel set and capture refuses them, privacy C-6): corrected to 'every other participant', matching §2. Remaining conditions fell on privacy.tsx §13 — all adopted by Lex; full verdict recorded on #1958."
---

# N-3 Recruiter Canonical Copy — Speaker Labelling Advance Notice

> **What this artefact is.** The canonical copy a recruiter sees
> during Rekrut setup/onboarding and on the interview-scheduling
> surface, so the employer-side duty to inform (N-3) is visible where
> panels are composed — not buried in terms. It is **advance notice
> only** (design §4.5): it supplements, and never substitutes for,
> the own-screen delivery and own-agreement capture (N-1/N-2) that
> happen in the interview room. No delivery credit for N-1 is taken
> from any surface that carries this copy.

## 1. The canonical sentence (verbatim — do not paraphrase)

> Speaker labelling (where the candidate has given biometric
> consent): to label who said what in a recorded interview, we create
> a temporary mathematical template of each speaker's voice during
> processing; the template exists only while the labelling runs and
> is never stored. This applies to everyone in the call — candidate,
> recruiters, and panel members alike.

This is the same string carried by the room-page notice
(`PanelLabellingNotice`), the ConsentDialog standing disclosure, and
the customer-terms clause (companion artefact
`n3-customer-terms-clause.md`, §1 ¶1). If the sentence ever changes,
it changes everywhere at once, under a new notice version in the
`lib/panelLabelling.js` registry (current version: `br7-1`).

## 2. Recruiter setup / onboarding copy (full block)

**Heading:** Speaker labelling in recorded interviews

**Body:**

> [Canonical sentence, §1 verbatim.]
>
> Before a recorded interview, every participant — you, each panel
> member, and the candidate — is asked about speaker labelling in
> their own way: the candidate through their biometric consent, and
> you and each panel member on your own screens, in the interview
> room, for that interview. Labels are created only if the candidate
> has given biometric consent **and** every other participant has
> agreed on their own screen **at or before the recording starts**.
>
> If anyone declines or does not agree, the interview and the
> recording still go ahead — the transcript simply will not show who
> said what. A decline costs the person nothing, so please do not
> ask your panel members to answer in any particular way.
>
> As the employer, you also have a duty to let your interviewers and
> panellists know about speaker labelling before they take part —
> see your customer terms. This page is a reminder of that duty, not
> a substitute for telling them, and telling them is not a
> substitute for their own decision in the room.

## 3. Interview-scheduling surface copy (short form)

Shown where a recruiter composes a panel for an interview:

> **Speaker labelling:** if this interview is recorded, speaker
> labels are created only where the candidate has given biometric
> consent and every other participant has agreed to speaker labelling
> on their own screen at or before the recording starts. Anyone can decline —
> the interview and recording still go ahead, without labels. Please
> let your panel members know before the interview; they will each
> decide for themselves in the room.

## 4. Verification against the shipped gate (dev @ 6ac9c15eb)

| Copy claim | Shipped behaviour (evidence) |
|---|---|
| Labels only if candidate biometric consent **and** every other participant agreed | `lib/diarizationGate.js`: candidate legs first (governing-session biometric consent + observer gate), then the panel leg requires a latest `granted` decision from every user in the recording's frozen expected set (recruiter ∪ panel members, candidate excluded). Either leg failing = no labels. |
| Agreement is on each participant's own screen, for that interview | Token `labelling_notice` carries only the caller's own state; `PanelLabellingNotice` renders only the caller's own control; capture keys to `req.user.id` + the event (per-interview, never evergreen). |
| Agreement must be recorded at or before the recording starts | Gate P3 blocks `PANEL_AGREEMENT_AFTER_RECORDING` only when `decided_at > started_at` (an agreement at exactly `started_at` counts), and judges the notice version in force at `started_at`. |
| Decline → interview and recording proceed, transcript unlabelled | ADR-D07 as built: a panel decline blocks only diarization (`PANEL_AGREEMENT_DECLINED`, state folds to `unavailable`); it never touches recording consent or egress. |
| A panel grant alone does not turn labelling on | The capture/token carry `decision_scope: "panel_leg_only"`; the room notice's grant copy states labels are created "only if every participant agrees and the candidate has given biometric consent". `DIARIZATION_ENABLED` also remains OFF until S-D17. |

## 5. Placement rules (for whoever wires this copy into surfaces)

1. The §1 sentence is never edited locally on a surface — surfaces
   render the canonical string or link to a surface that does.
2. The §2 block belongs in recruiter onboarding/setup; the §3 short
   form belongs on the interview-scheduling surface where panel
   members are added. Neither placement is the capture surface, and
   neither may carry an Agree/Decline control — capture happens only
   in the interview room, on each participant's own screen.
3. No surface carrying this copy may state or imply that reading it
   is agreement, that a recruiter can agree on a panel member's
   behalf, or that labelling is on because a panel member agreed
   (necessary, not sufficient — §4).

*Lex advises; Lex does not approve. Counsel determines CF-6.*
