# S-084 Counsel Brief — Threat-Intel Signals: Three Determinations Requested

**To:** External counsel (engagement to be confirmed)
**From:** Rekrut AI — prepared by Lex, Legal & Compliance persona (virtual team), for Sumanth (Founder) via Lead / Suga (CTO)
**Date:** 2026-10-12
**Re:** Focused determinations needed before any threat-intel signal is released to employer customers
**Related:** Issue #784 — `[STORY] S-084: Threat-intel implementation planning (story breakdown)`; Issue #764 — threat-intel checks follow-up (spec, S-081); spec at `docs/sdlc/rekrut-ai-v2/03-solutioning/unified-interview-engine/threat-intel-checks-spec.md`
**Status:** Planning only. The narrowed v1 described below is Lead's recommendation; Sumanth's approval of it is still pending. This brief supports that planning decision — it is not approval to build, and nothing in it authorises release of any signal.

> **Disclaimer — read first.** This brief frames questions about Rekrut's facts for determination by qualified external counsel. It is **not legal advice, not a legal determination, and not a substitute for counsel's advice**. Statements of law below are working hypotheses drawn from internal compliance reference material (stated as of mid-2026 and flagged for verification where the law was in transition) and are included only so counsel can see what we think the issues are and correct us. Rekrut will not treat any position in this brief as settled until counsel determines it in writing. This brief rides along with the already-standing counsel review of our biometric consent flow and data-retention lifecycle; we ask counsel to flag any overlap or conflict between the two reviews.

**Framing.** Rekrut AI is a B2B hiring platform launching in January 2027, initially for employer customers and candidates in the USA, Europe, and India. We are planning — not yet building — a "threat-intel" capability that would surface fraud-related observations about a job application to the hiring employer (for example, that several applications to that employer came from the same IP address). Our own spec already commits to a restrictive posture: signals are observations for human review, never verdicts; there is no composite fraud score, no auto-rejection, no cross-employer sharing, and no persistent blocklist. Three questions nevertheless turn on legal characterisations of *our* model that we cannot make for ourselves, and each one changes what we are allowed to build, in what order, and at what cost. Those three questions are the whole of this brief. For each we give the question, our facts, why it matters, what we need counsel to determine, and the interim guardrails we are holding meanwhile.

---

## Point 1 — Is Rekrut a consumer reporting agency (CRA) when it furnishes threat-intel signals to employer customers?

### The question

When Rekrut furnishes a threat-intel signal about an identifiable candidate to an employer customer, knowing the employer may use it in an employment decision, is Rekrut acting as a "consumer reporting agency" furnishing a "consumer report" under the US Fair Credit Reporting Act (FCRA, 15 U.S.C. §1681 et seq.) — and, in parallel, is the signal an "investigative consumer report" or consumer report under California's ICRAA / CCRAA or any other state mini-FCRA that matters at launch?

### Our facts

- Rekrut is the platform vendor, not the employer. The hiring decision is the employer customer's. Rekrut's customers are employers; candidates apply to those employers through Rekrut.
- **Narrowed v1 (proposed, not approved):** build only the chassis plus **one internal signal** — repeat applications to the *same* employer from the *same* IP address. The signal is derived solely from data generated inside Rekrut's own platform in the course of that employer's own applications. It is **siloed per employer in code**: employer A never sees a signal derived from applications to employer B, and no signal is pooled, sold, or shared across customers.
- The signal is **`info` severity only**, advisory-only in a recruiter review UI in which the recruiter must actively confirm or dismiss it. It is designed to be reviewable and disputable: provenance, timestamp, and source are shown with the signal. There is **no silent auto-rejection** — a signal cannot block, rank, score out, or reject a candidate, and application flow proceeds regardless of whether any check runs or fails.
- **No external source is in narrowed v1.** Every external source we evaluated is blocked at our $0 budget by its own terms (AbuseIPDB free tier is non-commercial use only; HaveIBeenPwned's email API is paid, with k-anonymity at Pro pricing of $4,548/yr as quoted to us; XposedOrNot requires a commercial licence and caps free use at 100 checks/day). FBI IC3 material would be used, if at all, as general fraud-trend context, never as an individual lookup. The earlier spec's §7.1 working assumption — that an FCRA trigger is "unlikely" because no CRA is involved and checks would be in-house — is exactly the assumption we are asking counsel to test, not rely on: Rekrut is a third party vis-à-vis both candidate and employer, and it would be furnishing the signal *to* the employer.
- We do not collect SSNs or government IDs at application time, and threat-intel would not touch biometric data (which sits behind a separate, fail-closed consent gate).

### Why it matters / exposure

The CRA characterisation is binary in consequence and procedural in content. If Rekrut is a CRA furnishing consumer reports for employment purposes, then a compliance sequence attaches that our current application flow does not have, including (as we understand the framework, for counsel to confirm or correct):

- **Accuracy and procedure duties on the furnisher/CRA side** — reasonable procedures to assure maximum possible accuracy (§1681e(b)), and dispute handling with reinvestigation duties (§1681i), alongside any furnisher duties that apply to information we contribute (§1681s-2).
- **Employer-side sequence that our product would have to support and evidence** — the employer's certification of permissible purpose (§1681b(b)(1)); a clear, conspicuous, **stand-alone** disclosure and written authorisation before a report is procured (§1681b(b)(2)); for investigative consumer reports, the additional disclosure and nature-and-scope rights (§1681d); **pre-adverse action** — a copy of the report plus the CFPB "Summary of Your Rights" and a reasonable waiting period (common practice: 5 business days) before any action taken even partly on the report (§1681b(b)(3)); then an **adverse-action notice** naming the reporting agency, stating it did not make the decision, and giving the 60-day free-copy and dispute rights (§1681m); and secure disposal (§1681w / FTC Disposal Rule).
- **Class-action-shaped exposure if the sequence is wrong.** FCRA disclosure-form defects are a well-known class-action trigger; willful non-compliance carries statutory damages of $100–$1,000 per consumer plus punitive damages and fees (§1681n), negligent non-compliance actual damages and fees (§1681o) — figures and current case law to be verified by counsel. California's ICRAA in particular is, per our spec's privacy review, the more likely real exposure, because it can reach reports and in-house investigative activity that federal FCRA may not.
- **Design consequences differ sharply by answer** (see below), and retrofitting the sequence after signals have shipped is the expensive, claim-creating path. That is why this determination gates release, not just design.

### What we need counsel to determine

1. On the narrowed-v1 facts above, is Rekrut a CRA, and is the repeat-IP signal a consumer report (or a California investigative consumer report), when furnished to the employer customer? Please identify **which facts the determination turns on** — e.g. regularity of furnishing, fee/SaaS consideration, assembly or evaluation of information from more than one application, the employer's expected use in eligibility decisions, and whether per-employer siloing and single-platform sourcing change the analysis.
2. If the answer is **yes**: what is the complete pre-release compliance programme (disclosure/authorisation flow, certifications, pre-/post-adverse-action workflow in-product, dispute and reinvestigation handling and timelines, accuracy procedures, retention and secure disposal, contract terms with employer customers allocating each duty)? What, if anything, must Rekrut stop doing or never start?
3. If the answer is **no for narrowed v1 only**: what are the **tripwires** that would change the answer — adding any external source, pooling or cross-employer comparison, charging separately for the signal, marketing it as "screening" or a "background check", furnishing it to anyone other than the hiring employer, or letting it affect ranking — so we can encode them as product prohibitions and re-referral triggers to counsel?
4. If the answer is **mixed / signal-dependent**: which signal types fall on which side, so each can be gated separately?
5. Separately: does Rekrut have any *furnisher-side* duties (accuracy on contribution, dispute investigation on notice) in any scenario, including the "not a CRA" scenario?

### Interim design guardrails we are holding meanwhile

- **No threat-intel signal is released to any recruiter until this determination is obtained and recorded** (tracked as a P0, launch-blocking story — see the companion issue created with this brief).
- No external sources, no cross-employer pooling or sharing, no composite score, no severity above `info`, no auto-rejection or blocking, no use in ranking.
- Signals, if ever shown, must carry provenance, timestamp, and source, and must be confirmable/dismissible by a human, with dispositions auditable.
- We will adopt FCRA-style adverse-action hygiene voluntarily in the interim design (candidate sees what was relied on, gets a chance to respond before a rejection that rests on a signal, and gets a dispute path), without representing to anyone that this makes us FCRA-compliant.
- Any scope change listed as a potential tripwire above is frozen pending re-referral to counsel.

---

## Point 2 — What disparate-impact validation approach is defensible for the repeat-IP signal?

### The question

Before the repeat-IP signal may influence any employment decision — even as one advisory input among others — what validation and ongoing monitoring would counsel expect us to have done and documented to defend the signal against a disparate-impact / discrimination-by-proxy challenge, in the US, the EU, and India?

### Our facts

- The signal is a correlation, not an identity finding: **an IP address is not a person.** The same public IP can legitimately be shared by a household, a multi-family building, a student residence, a shelter, a library or public Wi-Fi, a corporate NAT/VPN egress, and — very commonly — large numbers of mobile subscribers behind carrier-grade NAT. IPs are also dynamically reassigned between unrelated subscribers.
- The populations most likely to share IPs are not randomly distributed. Shared and mobile-only internet access correlates with income, housing type, geography, and — through those — potentially with race, national origin, and other protected characteristics. A signal that fires more often on applicants from shared housing or mobile-only access therefore risks systematically flagging protected groups for extra scrutiny, even though the signal's text mentions no protected characteristic.
- Legitimate behaviour also triggers it: members of one household applying to the same large local employer, students applying from one campus network, or one candidate re-applying, are all "repeat applications to the same employer from the same IP."
- The signal is, by design, the weakest form of input: `info` severity, advisory-only, human confirm/dismiss, no auto-rejection, no score. But we do not assume "advisory" ends the inquiry — a lead that recruiters routinely act on can influence decisions in fact, and automation bias (treating a system-generated flag as a finding) is a documented failure mode our spec already tries to counter with UI copy ("a lead, not a finding") and disposition auditing.

### Why it matters / exposure

- **US:** Disparate-impact liability under Title VII (*Griggs*) survives regardless of intent, and state laws and private plaintiffs remain active even where federal enforcement priorities have shifted *(verify current enforcement posture)*. Our reference material also flags the surrounding AI-hiring layer — NYC Local Law 144 bias-audit and notice duties if a tool is an automated employment decision tool, Illinois HB 3773 (discriminatory-effect AI as a civil-rights violation, effective 1 Jan 2026), Colorado's high-risk AI duties, and California FEHA automated-decision-system rules with extended record retention — any of which may or may not reach an advisory signal, which is part of what we need determined.
- **EU:** The equality directives shift the burden to the employer once a candidate shows facts suggesting discrimination, which makes the employer's — and our — documentation the defence. GDPR Art. 22 and the AI Act's treatment of hiring AI as high-risk are also in the background for any signal that drifts from advisory to determinative.
- **India:** No AI-hiring statute yet, but DPDP accuracy duties apply where data is used for decisions affecting the person, and a validation record is the practical answer to an accuracy or fairness complaint.
- A validation approach invented by engineers after launch, or applied to data we were not entitled to collect in the first place (see the demographic-data problem below), would be worse than none. We need the method settled **before** release, while "collect nothing and test nothing" is still available as a design choice counsel can endorse or reject.

### What we need counsel to determine

1. **Pre-release validation:** What study design would counsel consider defensible for this signal — what is measured (signal fire-rate and recruiter disposition/outcome rates by group), against what comparator, over what sample, and with what statistical standard? Is the four-fifths rule an adequate screening heuristic here, or only a starting point?
2. **The demographic-data problem:** Validation requires knowing outcomes by protected group, but collecting protected-characteristic data from candidates creates its own legal risk and, in the EU, special-category issues. What is the lawful way to obtain the data needed for testing (voluntary self-ID, aggregate-only handling, independent tester, proxy-estimation methods), in each launch region, and what must we **not** collect?
3. **Thresholds and consequences:** What disparity, if found, requires suppressing the signal (for a group, a geography, an IP type such as carrier NAT, or entirely)? Should known-shared IP classes (carrier-grade NAT, education, corporate egress) be excluded or down-weighted by design, and is a counsel-approved exclusion list defensible?
4. **Ongoing monitoring:** Expected cadence, owner, and record — periodic re-validation, disposition/outcome audits for automation bias, complaint-triggered review — and how long validation records must be retained (noting, e.g., California's longer ADS record retention in our reference material — *verify*).
5. **Permitted influence:** On a satisfactory validation, what use is defensible — `info`-only advisory as designed; may a *confirmed* signal ever be one documented factor in an individualised assessment, and if so what must that assessment record (cf. the individualised-assessment pattern in fair-chance practice)? What uses remain prohibited regardless of validation results?
6. Whether any launch-region AI-hiring regime (NYC LL 144, Illinois, Colorado, California, EU AI Act) is triggered by this signal as designed, and what notice/audit duties follow if so.

### Interim design guardrails we are holding meanwhile

- The signal stays `info`-only, advisory, non-blocking, and incapable of auto-rejection; it is never the sole basis for any adverse step, and any rejection that followed a signal requires a documented, individualised, human reason independent of the signal.
- Provenance, timestamp, source, and an "investigatory lead, not a finding" explanation travel with the signal; confirm/dismiss dispositions are logged and auditable.
- No escalation of severity, no combination with other signals into a score, and no expansion to new IP-derived inferences (geolocation suspicion, VPN/datacenter classification) pending counsel's answer on this point as well as Point 1.
- No validation study will be run, and no demographic data collected for one, until counsel approves the method.
- If counsel advises that no defensible validation is possible at launch scale, our fallback is to **not release the signal** — the chassis ships dark.

---

## Point 3 — DPO trigger assessment at launch scale

### The question

At Rekrut's actual launch scale and processing profile, are we required to appoint a Data Protection Officer — under GDPR Art. 37 in Europe, or as a consequence of likely Significant Data Fiduciary notification under India's DPDP Act — and if so (or if we appoint one voluntarily), how do we staff the role conflict-free on a $0–low budget?

### Our facts

- **Processing profile, not just headcount, is the driver.** Rekrut's core activity is operating a hiring platform for many employer customers: systematic processing of candidate data at whatever scale launch brings, including — in the interview module, behind a separate fail-closed biometric consent gate — voice/video and biometric-adjacent analysis, integrity monitoring of interview sessions, 90-day recording retention, and DSAR/erasure machinery. Threat-intel adds systematic screening-style processing of application data. Launch candidate/employer volumes are projections, not actuals; we can supply counsel our launch targets and first-year growth assumptions on request.
- **Europe:** We expect EU candidates and at least some EU-facing activity at launch, but our establishment structure (EU entity / no EU entity) is a fact counsel should confirm with us, since it also bears on the Art. 27 representative question.
- **India:** Rekrut's founder roadmap is India-centred from January 2027, and Indian candidates and employers are a launch market. Under the DPDP Act, Significant Data Fiduciary status is **notified by the government** based on volume, sensitivity, and risk — it is not self-elected — and carries an India-based DPO reporting to the board, periodic DPIAs, independent audit, and algorithmic due-diligence duties. DPDP obligations were, per our reference material, still in transition (commencement ≈ May 2027 — *verify*), with the IT Act / SPDI Rules applying meanwhile, including a grievance-officer requirement.
- **Budget reality:** $0–low. The founder and the CTO function currently determine the purposes and means of processing — which, as we understand Art. 38(6), is precisely why neither can simply double as a conflict-free DPO. We currently have a designated privacy contact in substance, but we have **not** represented anyone as "DPO" to candidates, customers, or regulators.

### Why it matters / exposure

- If a DPO is mandatory and absent, that is a regulator-visible, per se compliance failure in the EU (GDPR fines reach €20m or 4% of global turnover at the ceiling — *verify current enforcement practice*), and enterprise employer customers routinely diligence DPO/DPIA posture before signing — so this is also a sales blocker, not only a regulatory one.
- If Significant Data Fiduciary notification is likely at our scale/profile, the DPO, DPIA, and audit duties arrive on the government's timetable, not ours, and the lead time to staff an India-based, board-reporting DPO is a launch-planning input we need now.
- Conversely, appointing a "DPO" voluntarily, or titling an internal person as one, can import the statutory independence and conflict rules and create expectations we cannot meet at $0 — a self-inflicted exposure if done casually.

### What we need counsel to determine

1. **GDPR Art. 37:** On our processing profile and launch-scale projections, is DPO appointment mandatory for Rekrut as controller and/or as processor for employer customers — which limb of Art. 37(1) is engaged (large-scale systematic monitoring, and/or large-scale special-category processing via the biometric interview features), and at what volume does the answer change? Do any member-state rules (e.g. Germany) lower the threshold for our likely EU footprint?
2. **Structure:** Does our establishment footprint require an EU representative (Art. 27) regardless of the DPO answer, and can one provider cover both roles?
3. **India DPDP:** How likely is Significant Data Fiduciary notification for a hiring platform of our profile and projected Indian volumes, on what indicative timetable, and what should we build now (India-based DPO readiness, DPIA cadence, audit readiness, algorithmic due diligence for the interview/threat-intel features) so notification is not a scramble? What applies in the interim under the SPDI Rules (grievance officer, published contact)?
4. **Conflict-free staffing at $0–low budget:** Is an external / fractional DPO service acceptable in each regime, what independence and conflict conditions must the contract guarantee (Art. 38), what tasks must never be combined with the DPO role, and what is a realistic low-end cost band we should budget? If external appointment is premature, what interim structure (named privacy lead without the DPO title, documented escalation to counsel) does counsel endorse?
5. Whether employer customers, as controllers, will contractually require Rekrut to maintain a DPO as a processor-side contact — i.e. is this a de facto requirement even if not a statutory one at launch?

### Interim design guardrails we are holding meanwhile

- No one is titled, published, or held out as "DPO" until counsel determines status; a privacy contact/grievance contact is published as required for the interim Indian regime and as a DSAR contact generally.
- Accountability artefacts are maintained as if a DPO (or a notifying regulator) will ask for them: record of processing activities, DPIAs for the biometric observer and for threat-intel before any release, retention schedule (including the two-tier pattern already in our design — threat-intel rows follow the parent application's erasure lifecycle, while source query/audit logs are purged after 90 days), and DSAR/erasure logs.
- Independence in substance: privacy-compliance findings in our process are recorded and reported to the founder unedited, even where no statutory DPO exists yet.
- A budget line for external DPO services is flagged in launch planning, unspent pending this determination.

---

## What we are asking for, in one place

1. A written determination on Point 1 (CRA status), including the facts it turns on and the compliance programme or tripwire list that follows from the answer. **This gates any release of any threat-intel signal.**
2. A written position on Point 2: the validation/monitoring method counsel would defend, the lawful way to obtain testing data, suppression thresholds, and the permitted-influence boundary for the repeat-IP signal.
3. A written assessment on Point 3: DPO triggers at launch scale in the EU and India, structural requirements (representative, grievance officer), and an endorsed conflict-free, low-budget staffing model.
4. For each point: anything in our stated facts or interim guardrails that counsel considers wrong, insufficient, or itself risky — we would rather be corrected on paper now than in production in January 2027.
5. A fee estimate and indicative timeline for the above, and confirmation of how this brief interacts with the standing consent/retention review already with counsel.

*Prepared by Lex (Legal & Compliance persona) — advisory only; Lex advises and flags determinations for counsel, and never approves. Routed to Sumanth via Lead / Suga. This brief is an internal compliance aid, not legal advice.*

*Sources consulted in preparation (internal, mid-2026, verify-flagged): `global-hiring-compliance` skill — `references/usa.md` §5 (FCRA) and §§2–4, `references/india.md` §2 (DPDP candidate data, Significant Data Fiduciaries), `references/eu.md` §§1–2 (GDPR recruitment, Art. 37 DPO, Art. 10); Rekrut threat-intel spec (S-081 / #764), §7 privacy and legal boundaries.*
