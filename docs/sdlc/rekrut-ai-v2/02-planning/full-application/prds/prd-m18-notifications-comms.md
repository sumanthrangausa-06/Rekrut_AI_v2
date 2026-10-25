# PRD — M18: Notifications, Email & Communications

**State (verified, Scout §2): WORKS.** **Surfaces:** `routes/notifications.js`, `voice-notifications.js`, `email-tracking.js`, `communications.js`, `chat.js`, `lib/email-service.js` (Brevo), `lib/email-queue.js` · client: chat (both sides), recruiter-communications, admin/email-queue.

## 1. Purpose & users
Every message the platform sends: in-app notifications, transactional email (auth resets, invites, interview scheduling, status changes), email queue + tracking, and candidate↔recruiter chat. Users: all roles.

## 2. End-to-end journey
Event fires (application status, invite, schedule) → notification created → email queued (`lib/email-queue.js`) → Brevo send (API + SMTP relay, `lib/email-service.js:22-28`) → delivery/open tracking. Chat runs in parallel as the in-app channel, with read receipts deferred (#337).

## 3. Current state (verified)
Wired end-to-end in code. #99 ("no email provider on staging") is **stale as titled** — Brevo credentials were configured on staging 2026-10-07; the residual truth is **behaviourally unverified**: nobody has evidenced a full staging send→deliver→track round-trip since.

## 4. Gap to launch-ready
One evidence gap, and it's launch-critical in disguise: password resets, invites, and interview scheduling all ride this module. The gap closes with a staging evidence run (test-mode sends to controlled addresses at promotion time — Relay/Quinn scope), not with code.

## 5. Functional requirements
- FR-M18-1: Every transactional email class (reset, invite, schedule, status, offer) has a template + queue path + tracking; a missing template fails loudly in logs, never silently drops a send.
- FR-M18-2: Chat messages are company/candidate-scoped by the object-authorisation convention (M6's class applies here: chat history is candidate PII).
- FR-M18-3: Email content templates pass the same copy discipline as product copy for anything consent- or decision-related (Lex signs consent-adjacent wording, per the S-039/S-048 precedent).

## 6. Non-functional
- Deliverability: sends go through Brevo only (no ad-hoc SMTP); queue retries are bounded and visible in the admin email-queue surface.
- Privacy: tracking pixels/opens are disclosed in the privacy policy surface (S1) if used — tracking without disclosure is not acceptable at launch.

## 7. Dependencies (verified states)
Brevo account (configured on staging 2026-10-07; behaviour **unverified**) · M1 reset/invite flows (exist) · M19/S1 policy disclosure (exists; tracking disclosure is FR-M18-3's sibling check).

## 8. Sprint 11 overlap
None.

## 9. ⚠ Unverified
Staging send→deliver→track round-trip (the #99 residual); voice-notification behaviour; chat read-receipt state (#337 deferred by earlier decision).

## 10. ▣ DECISIONS FOR SUMANTH
- None. (The staging evidence run is a promotion-track task for Relay/Quinn, gated by your promotion approval under D2 — not a new decision.)
