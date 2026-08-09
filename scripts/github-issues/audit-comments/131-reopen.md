**Audit 2026-08-08** - verified against `origin/dev` at `9eaa2af`.

**Reopening. This was closed as completed roughly two hours after it was filed, but the cryptographic engine it describes does not exist.**

## What the search found

`git grep -i "pkcs7|pkcs#7|cryptographic seal|timestamp authority"` against `origin/dev` returns no implementation. The hits that come back are all something else:

| Hit | What it actually is |
|---|---|
| `routes/billing.js`, `scripts/test-stripe-flow.js`, `scripts/test-webhook.js` | Stripe **webhook** signature verification, unrelated to document signing |
| `client/src/pages/candidate/offers.tsx` | `signDialog`, `signatureName`, `signing` state, a typed-name capture |
| `routes/onboarding.js`, `migrations/018_extend_onboarding_documents.js` | Storage for that typed name |

There is no PKCS#7 signing, no certificate handling, no timestamp authority client, and no signature verification path.

## Why the distinction matters

What exists today is a candidate typing their name into a box, which is stored as a string. That is an **acknowledgment**, not a cryptographic signature. It carries none of the properties this issue was written to deliver:

- No tamper-evidence, so the offer document can be altered after signing with no detectable trace
- No proof of signing time, so no defence against a backdating claim
- No cryptographic binding between the signer and the exact bytes of the document signed
- No independently verifiable artifact, so nothing can be validated outside our own database

Offer letters are legally consequential documents. A typed name is defensible as a UI affordance in an MVP, but it should not be recorded as satisfying the requirement for a sealed e-signature engine.

## Recommendation

Keep the typed-name flow as the interim UX, and treat this issue as the real remaining work. If shipping before the engine is ready, the acceptance UI should be explicit that it is an acknowledgment rather than implying legal sealing.

This is the fourth issue in this audit closed as completed with no supporting code, after #62, #60 and #63. Worth a look at how closures are being recorded, since the board is currently overstating what is done.
