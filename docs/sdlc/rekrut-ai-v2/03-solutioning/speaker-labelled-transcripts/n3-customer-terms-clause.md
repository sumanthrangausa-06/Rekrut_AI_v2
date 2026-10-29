---
project: Speaker-Labelled Interview Transcripts (Diarization) — BR-7 N-3 Customer-Terms Clause (Companion Artefact)
version: 1
status: drafted by Lex (authorship) — counsel review under CF-6 pending; NOT yet integrated into the live customer terms
created: 2026-10-29
owner: Sumanth
author: Lex (Legal & Compliance persona)
issue: "#1958 — [STORY] S-D21: BR-7 N-3 artefacts (parent #1952, epic #1900)"
design: br7-panel-notice-design.md §11 item 1 (this folder)
lex_basis: "#1919 comment 6486823870 (Lex BR-7 position) condition N-3; LEX-POSITION.md BR-7 addendum"
gate_basis: "Wording verified against the shipped gate on dev @ 6ac9c15eb — lib/diarizationGate.js panel leg (S-D19, PR #1963), lib/panelLabelling.js, routes/interview-events.js capture + §7.1 purge, lib/diarizationEnqueue.js. See §5 of this artefact for the claim-by-claim check."
specialist_reviews:
  - "agency-agents/engineering-privacy-engineer — MANDATORY (design §15), reviewed this artefact + the recruiter canonical copy + the privacy.tsx §13 rider against the shipped gate: ACCEPT-WITH-CONDITIONS, no BLOCK. This artefact required no change (its verification table verified accurate; ¶3's absolute decline wording is cured by ¶4's purge statement read as a whole). Conditions C-1…C-3 fell on privacy.tsx §13 and C-4 on the recruiter copy §3 — all adopted by Lex; full verdict recorded on #1958."
---

# N-3 Customer-Terms Clause — Speaker Labelling (BR-7)

> **Status of this document.** This is the companion artefact the BR-7
> design (§11 item 1) requires: the clause text, drafted by Lex, ready
> for counsel review under CF-6 and for integration into Rekrut's live
> customer terms. **It is not in force.** Integration into the live
> customer terms is a release action for Suga/Sumanth, not part of the
> S-D21 build. Until it is integrated, this artefact blocks
> external-customer enablement of speaker labelling (design §15,
> S-D21); it does not block internal enablement (S-D17).

## 1. The clause (text for the customer terms)

> **Speaker labelling of recorded interviews — your duty to inform
> your interviewers and panellists**
>
> 1. **What speaker labelling is.** Some recorded interviews on Rekrut
>    may carry automated speaker labelling. The disclosure text we
>    supply for this processing — and the text each participant sees
>    on their own screen — is:
>
>    > Speaker labelling (where the candidate has given biometric
>    > consent): to label who said what in a recorded interview, we
>    > create a temporary mathematical template of each speaker's
>    > voice during processing; the template exists only while the
>    > labelling runs and is never stored. This applies to everyone
>    > in the call — candidate, recruiters, and panel members alike.
>
> 2. **Your duty to inform.** Before any of your interviewers,
>    recruiters, or panel members takes part in a recorded interview
>    that may be speaker-labelled, you must inform them that the
>    interview may carry automated speaker labelling of their voice,
>    using the supplied text in paragraph 1 or wording to the same
>    effect. Rekrut also shows this disclosure to each participant on
>    their own screen before recording and asks for their own
>    agreement there; your duty under this clause supplements that
>    in-product notice and does not replace it, and the in-product
>    notice does not discharge your duty as their employer.
>
> 3. **Agreement is personal, and a decline must stay free.** Each
>    participant's agreement to speaker labelling is their own
>    decision, made on their own screen, for that interview only. You
>    must not instruct, direct, require, or pressure your staff to
>    agree — or to decline — in any particular way, and you must not
>    treat a decline or a withdrawal as a negative factor in any
>    employment decision. If any participant declines or does not
>    agree, the interview and the recording can still go ahead; no
>    speaker labels are created for that recording, and the
>    transcript simply does not show who said what.
>
> 4. **Timing.** A participant's agreement counts for a recording
>    only if it is recorded at or before the time that recording starts. An
>    agreement given after a recording has started does not apply to
>    that recording (it can apply to a later recording of the same
>    interview). A participant may change or withdraw their agreement
>    at any time; a decline or withdrawal recorded after labels were
>    created for a recording causes those labels to be removed.
>
> 5. **Your responsibilities as employer.** You are responsible for
>    having a lawful basis for the processing of your own staff's
>    voice data in your capacity as their employer, and for any
>    written release or consent form your own legal advice requires
>    in the jurisdictions where your staff are located. Rekrut's
>    in-product agreement capture does not replace any such release
>    or form.

## 2. Why the clause is shaped this way (Lex notes)

- **The supplied text is canonical, not illustrative.** Paragraph 1
  quotes the BR-7 sentence verbatim — the same string the room-page
  notice (`PanelLabellingNotice`), the ConsentDialog, and the
  recruiter canonical copy (companion artefact
  `n3-recruiter-canonical-copy.md`) carry — so an employer cannot
  inform its staff with weaker words than the product itself shows.
- **The no-instruction duty (paragraph 3) protects the decline's
  freeness.** ADR-D07 (design §2) chose "decline = no diarization on
  that recording" over excluding the decliner precisely because an
  agreement extracted as a condition of doing one's job is worth
  nothing. A customer who directs its staff to agree would defeat
  that design from outside the product; the clause closes that route
  contractually.
- **Paragraph 4 mirrors the gate, it does not soften it.** The
  timing rule (agreement recorded at or before the recording's start,
  #1970 M-1) and the post-write purge are shipped
  behaviour (§5 below), stated here so a customer is never surprised
  that a late agreement did not label a recording already made, or
  that a withdrawal removed existing labels.
- **Paragraph 5 keeps the controller/processor line honest.** Rekrut
  is the processor for customer interview data; the employment-law
  basis for processing staff voices (and any fuller written release,
  e.g. an Illinois BIPA §15(b) release) is the employer's and its
  counsel's — that is counsel flag CF-6, which this clause flags and
  does not answer.

## 3. What this clause is not

- Not a substitute for N-1/N-2: the employer's duty supplements the
  own-screen delivery and own-agreement capture; neither discharges
  the other (Lex's N-3 framing, #1919 comment 6486823870).
- Not legal advice to any customer, and not a determination that the
  click-capture satisfies any particular statute — CF-6 (BIPA §15(b)
  form and §15(a) schedule for panellists, GDPR employment basis,
  DPDP employer legitimate-use) is lodged with counsel and open.
- Not in force until integrated into the live customer terms by a
  release action (Suga/Sumanth).

## 4. Integration checklist (for the release action, not this story)

1. Counsel review of §1 under CF-6; any fuller-release requirement
   for IL/TX/WA panellists lands as an amendment to paragraph 5
   before external enablement for customers with staff there.
2. Insert into the customer terms as a speaker-labelling section;
   version and date the terms; existing customers are notified under
   the terms' own change clause.
3. Confirm the recruiter onboarding/setup surfaces carry the
   canonical copy (companion artefact) at the same release.
4. Record integration (terms version + date) on #1952 and update the
   S-D17 checklist: N-3 satisfied for external-customer enablement
   only from that record.

## 5. Verification against the shipped gate (dev @ 6ac9c15eb)

| Clause claim | Shipped behaviour (evidence) |
|---|---|
| Labelling needs the candidate's biometric consent (¶1 supplied text) | `lib/diarizationGate.js`: candidate legs (governing-session biometric consent + observer gate) run first and block on any failure; the panel leg is never evaluated when a candidate leg blocks. |
| Every other participant's own agreement is also required (¶1–¶3) | Panel leg: every user in the recording's frozen expected set (recruiter ∪ `panel_member_ids`, candidate excluded) must hold a latest `granted` decision in `event_labelling_consent`, else `PANEL_AGREEMENT_*` block and no labels. |
| Agreement is made on the participant's own screen, per interview (¶3) | Capture endpoint `POST /api/interviews/events/:eventId/labelling-consent` keys the row to `req.user.id` for that event only; the token/room notice renders only the caller's own control (S-D18/S-D20). No evergreen or cross-event agreement exists. |
| Decline → interview and recording proceed, no labels (¶3) | ADR-D07 as built: a decline blocks only the diarization job (`PANEL_AGREEMENT_DECLINED`); recording consent is a separate, pre-existing gate the panel decision never touches (a panel `withdrawn` never stops egress). |
| Agreement must be recorded no later than the recording's start (¶4) | Gate P3: `decided_at > recording.started_at` blocks `PANEL_AGREEMENT_AFTER_RECORDING` — equality (`decided_at == started_at`) passes; the notice version must be the one in force at `started_at` (privacy C-7). |
| Withdrawal after labels exist removes them (¶4) | Capture handler: a `declined`/`withdrawn` decision triggers `purgeCompletedDiarizationForEvent` (§7.1) — run rows deleted, `speaker_number`s cleared, state folds to `unavailable`. |
| No posture leak (¶3's plain outcome) | Every block folds the recording's diarization state to `unavailable`; which participant blocked, and why, exists only on operator surfaces (job cancel reason + snapshots). |

*Lex advises; Lex does not approve. Counsel determines CF-6.*
