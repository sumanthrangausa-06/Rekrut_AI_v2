# Integrity Mitigation Brief: False Positives + Recruiter UX

**Date:** 2026-10-10
**Author:** Integrity UX Researcher (reporting to Suga, CTO)
**Status:** Research complete — recommendations for Sumanth's decision
**Related:** `technical-research-integrity.md` (detection techniques), `failure-mode-analysis.md` (I1, O3 risks)

> **Scope note:** This brief does not re-litigate *detection* techniques (covered in `technical-research-integrity.md`). It covers what happens *around* detection: preventing false flags from firing, and presenting evidence so recruiters interpret it correctly.

---

## Executive Summary

Our #1 and #2 risks are both human-side: false positives on legitimate candidates (I1) and recruiter misinterpretation of evidence (O3). The research consensus is stark:

1. **No proctoring vendor publishes a validated false-positive rate.** The only quantitative figure found: ~75% of flagged exams were false positives (SoftwareSecure whitepaper, competitor-sourced — directional, not validated). ProctorU abandoned AI-only proctoring entirely in 2021 after finding ~10% of faculty reviewed AI reports. **The industry's decisive lesson: AI flags without mandatory human review do not work.**

2. **Explanations and confidence numbers do not fix over-trust — workflow does.** The strongest evidence (Buçinca et al. 2021, replicated 2026) shows cognitive forcing functions — recruiter judges *before* seeing AI output — reduce overreliance more than any explainable-AI intervention. The effective interventions are the ones users dislike, so they must be built into the workflow, not offered as options.

3. **🚨 Compliance flag:** The EU AI Act **Article 5 prohibits emotion recognition in workplace and education contexts.** Sumanth's vision includes reading "facial expressions… emotional intelligence." Any feature inferring emotions from face/voice in interviews risks being a prohibited practice in the EU. **This needs legal review before Phase 3** — it may require scoping the behavioral analysis to exclude affect inference for EU deployments.

---

## Part 1: False-Positive Reduction

### 1.1 The false-positive landscape

| Finding | Source | Implication |
|---------|--------|-------------|
| ~75% of AI-flagged exams were false positives | SoftwareSecure whitepaper (100k+ reviewed exams; competitor-sourced, directional) | Raw AI flags are mostly noise without review |
| 8% FP rate in controlled study | Raj, Narayanan & Bijlani (2015) | Even in lab conditions, FPs are material |
| AI detectors flagged 61% of TOEFL essays (non-native English) as AI-generated | Stanford HAI research, cited 2026 | Population-norm detectors discriminate against non-native speakers |
| Autistic student's handwritten essay flagged 100% AI; she sued and won | Moira Olmsted / Adelphi University, Feb 2026 | Courts are now punishing over-reliance on detectors |
| WSU dropped Turnitin AI detection after 1,485 false positives in one semester | 2026 | Institutional tolerance for FPs is collapsing |
| Mathematical proof: no detector setting is both fair and effective | Griffith University researcher, arXiv preprint 2026 | FP/detection tradeoff is structural, not fixable by "better models" |

**The structural lesson:** False positives are not a tuning problem. They are inherent to comparing human behavior against a "normal" baseline — because neurodivergent candidates, non-native speakers, nervous candidates, and poorly-equipped candidates *are* the baseline's outliers. Mitigation must be architectural (below), not just threshold-tuning.

### 1.2 Calibration protocol (recommended)

**Evidence:**
- A MediaPipe-based webcam gaze system gained **10–20% accuracy after ~30 seconds of passive calibration** during normal use (Springer, 2026).
- Short calibration with good correction **nearly matched long calibration** (0.352 cm vs 0.299 cm error) (MDPI Appl. Sci.).
- Eye-tracking accuracy **degraded 0.30° between calibration and later testing**, drifting 0.13°/month (PubMed) — one-shot calibration goes stale; online updating is needed.
- Voice biometrics enrollment: **20 seconds** (Phonexia), **under 60 seconds** typical industry, **10 seconds** (VoiceVault). For *behavioral* voice baselines (prosody, pause patterns — not identity verification), no published optimal-duration curve exists; 30–60 s of natural speech is the reasoned inference.
- Microsoft Sentinel UEBA (production): builds **three profiles per entity — individual, peer-group, temporal** — and the peer comparison specifically reduces FPs from legitimate group-wide shifts.

**Recommended protocol for Rekrut AI:**

| Step | Duration | What happens | Signals captured |
|------|----------|--------------|------------------|
| 1. Device check | ~15 s | Camera/mic test, lighting estimate, device class detection | Signal-quality baseline (illumination, face pixel-size, audio SNR) |
| 2. Ice-breaker | ~45 s | Candidate answers 1–2 casual questions ("Tell me about your commute today") — framed as mic/camera test, not assessment | Speech rate (WPM), pause distribution, filler-word rate, baseline pitch/noise floor, gaze zone distribution |
| 3. Silent anchoring | Ongoing | EWMA (exponentially-weighted moving average) updates baselines during high-quality windows; re-anchors silently | Drift correction |

**Key design decisions:**
- **Passive, not intrusive.** The candidate experiences steps 1–2 as a tech check, not a test. (Evidence: intrusive calibration increases anxiety, which itself generates false-positive behavior.)
- **Per-session, not stored.** Baselines are derived fresh each interview (drift-safe, simpler GDPR/BIPA posture). Cross-session voiceprint storage is deferred — voiceprints are special-category data under GDPR.
- **Personal + cohort dual reference.** Compare against the candidate's own warm-up *and* the cohort distribution for the same question type. A candidate whose pause pattern matches their warm-up is not flagged even if they pause more than average.
- **"Insufficient data" is a first-class state.** If warm-up quality is below floor (bad lighting, noisy mic), the system records `signal_unavailable` — never a flag, never a score. The recruiter sees "insufficient data for gaze analysis," not a gap in the evidence.

### 1.3 Quality-weighted fusion (upgrade to the current rule)

**Current rule:** ≥0.85 confidence + 3+ independent signals → flag. This is a form of decision-level AND fusion. The literature supports this shape but suggests upgrades.

**Evidence:**
- **Bigun et al. (2003):** Bayesian model where quality enters as a variance parameter — high-quality samples get low variance and dominate the posterior.
- **Reliability-Aware Dynamic Score Fusion (2026):** sample-level reliability estimators for face+voice gained **+9.3 percentage points over fixed weighted-sum fusion**; reliability estimators had **AUC >0.95** at predicting sample correctness.
- **Confidence-Aware Gated Fusion (2026):** dynamically weighting by measured reliability beat naive fusion (p<0.001). Thesis: *weight by measured reliability rather than reconstructing degraded data.*
- **Dynamic Belief Fusion (arXiv 1511.03183):** explicit **"intermediate state"** between target/non-target; splitting FPs into "non-target" vs "uncertain" is what improves fusion. Maps directly to a "needs review" bucket.

**Recommended fusion design (implementable without new models):**

```
For each integrity signal i in window w:
  score_i      = detector output (0-1)
  quality_i    = measured reliability (0-1): face-detection confidence,
                 landmark visibility, illumination, audio SNR, device class
  weight_i     = quality_i^2          # multiplicative; low-quality → near-zero influence

  # Correlation discount: signals sharing a failure mode don't count independently
  if signals i,j share sensor AND quality < 0.5:
      weight_j *= 0.5                 # Dempster-style discounting

fused = Σ(weight_i × score_i) / Σ(weight_i)

Decision:
  fused ≥ 0.85 AND Σ(weight_i > 0.3) ≥ 3  → FLAG (consequential: review queue)
  0.60 ≤ fused < 0.85                     → UNCERTAIN (review queue, lower priority)
  fused < 0.60  OR  Σ(weight_i) < 1.0     → NO FLAG ("insufficient data" if quality-driven)
```

**What changes vs. the current rule:**
1. Signals below their quality floor are **excluded from fusion** (not counted as negative evidence, not counted as positive — excluded).
2. Correlated signals (gaze + face presence from the same degraded camera frame) are **discounted**, not double-counted.
3. An **"uncertain" band** routes to human review instead of forcing a binary flag/no-flag. This is the single highest-leverage change: it converts would-be false positives into review items.

### 1.4 Adaptive thresholds (published formula, directly implementable)

From a 2026 continuous-authentication paper (PMC):

> **τ_t = τ_min + (τ_max − τ_min)(1 − q_t)**

Where q_t ∈ [0,1] is a **context-quality index** (weighted mix of per-signal quality scores). When signal quality is poor, the threshold *rises* — it becomes harder to flag. Bounded for stability. The same paper applies EWMA smoothing before thresholding: flag on sustained deviation, not frame spikes.

**For Rekrut AI:** q = weighted average of (MediaPipe face-detection confidence, illumination estimate, face pixel-size/frontality, audio SNR, device class). Any signal below its quality floor is excluded from fusion and logged as `signal_unavailable` / `insufficient data` — never as a flag.

### 1.5 Fairness safeguards (counter-adversarial)

**Documented harm:**
- S.T.O.P.: proctoring AI compares behavior to a "normal" baseline; disabled students' expressions "differ from the 'normal' baseline… mislabeling their affect."
- Inside Higher Ed: ADHD fidgeting flagged; facial recognition failures for darker skin tones ("students risk being literally erased by AI").
- HireVue **retired facial analysis in 2020** after sustained pressure (kept vocal/language/timing analysis).
- Duke (2024): LLM encoders associated "I have autism" with stronger negative associations than "I am a bank robber" — relevant if any LLM scores transcripts.
- DOJ **$2.3M SafeRent settlement** — behavioral-signal discrimination is now enforcement territory.

**Recommended safeguards:**

1. **Self-declared accommodation mode** (pre-interview, standard step, non-stigmatized): candidate may select "I fidget / move frequently," "I stutter or pause when speaking," "I prefer not to say — apply wider tolerances," or nothing. Accommodation **widens** movement and speech-timing thresholds; it does not disable integrity. Framing matters: present as "help us calibrate to you," not "declare a disability."
2. **Never score affect.** No emotion, confidence, enthusiasm, or nervousness inference from faces or voice. (Extends the existing voice-deception-detection ban. Also see §5 compliance flag.)
3. **Response-latency signals use personal baselines only.** A stutter or processing difference shifts the population comparison but not the personal one — this is where per-candidate baselines are a *fairness* tool, not just an accuracy tool.
4. **Subgroup flag-rate audits** (post-launch dashboard): measure flag rates by accommodation status, device tier, and lighting condition. Any subgroup at >2× the baseline flag rate triggers threshold review. (The 2× bar is a proposal, not from literature — marked speculative.)
5. **Every flag is human-reviewable with evidence.** Automated flags alone will not survive appeals (Olmsted precedent).

---

## Part 2: Recruiter Evidence Presentation

### 2.1 Why this is the harder problem

| Finding | Source | Implication |
|---------|--------|-------------|
| When AI was wrong, radiologist accuracy collapsed: 79.7%→19.8% (inexperienced), 82.3%→45.5% (very experienced) | Dratsch et al. 2023, *Radiology* | Experience does NOT protect against automation bias |
| Cognitive forcing functions reduced overreliance **more than the best explainable-AI interfaces** | Buçinca, Malaya & Gajos 2021 ("To Trust or to Think"); replicated 2026 | Explanations are not the fix; workflow is |
| Participants *preferred* the explanation interfaces and rated forcing functions as more effortful | Same study | The effective intervention must be built into the workflow, not offered as a choice |
| Narrative AI explanations **degraded** human judgment rather than enhancing it | Harvard Business School / MIT / UW, 2026 | Don't lead with "why the AI thinks so" |
| In employment decisions, the dominant mechanism was *selective adherence* — following AI advice that confirms stereotypes | Alon-Barkat & Busuioc 2023 | A cheating flag gives recruiters a legitimate-sounding reason to reject; the UI must not serve as post-hoc rationalization |
| COMPAS: ~68% accuracy, no better than untrained laypeople; judges rubber-stamped with paper safeguards | Dressel & Farid 2018; *Loomis* | Numeric risk scores + nominal human review = the failure mode to avoid |

**The core insight:** A "cheating flag" is more dangerous than a "hire/don't hire" score. Recruiters may skeptically discount a hiring score, but a flag gives them a *justification* to reject — and selective adherence predicts they will use it asymmetrically against candidates they already doubt.

### 2.2 Evidence display design (recommended)

**Three-tier progressive disclosure** (evidence-informed; exact tier boundaries are inference):

**Tier 1 — Default view: fused observation in plain language**
- "3 gaze-away events during Q2 (12 seconds total)"
- Confidence as **Low / Medium / High tier** — never a bare percentage
- Timestamp chips linking to Tier 3
- Explicit non-verdict footer on every observation: *"This is an observation, not evidence of cheating."*
- **Never shown:** verdict nouns ("violation," "suspicious behavior"), agentive adjectives ("abnormal gaze"), raw sensor values

**Tier 2 — One click: contributing signals + alternative explanations**
- Which detectors fired, event timestamps and durations
- **Alternative benign explanations listed alongside every flag:** "Also consistent with: reading notes, second monitor, thinking, cultural gaze norms"
- Signal-quality context: "Gaze tracking quality was reduced during this segment (low lighting)"
- This is the falsification panel — designed to help the recruiter *rule out* cheating, not to justify the flag

**Tier 3 — Audit/forensics (available, never default):**
- Raw signal excerpts: video clip at the timestamp, gaze trace overlay
- Full event timeline for the session
- For appeals and audits, not for initial review

**What the recruiter NEVER sees by default:** raw coordinates, pitch values, model internals, a single fused "integrity score." (No study supports raw-sensor display improving decisions; it creates false precision. A single integrity score is the COMPAS failure mode.)

### 2.3 The judge-first workflow (highest-evidence intervention)

**The single strongest intervention in the literature:** the recruiter records their own assessment *before* seeing AI observations.

**Recommended workflow:**
1. Recruiter watches/reads the interview (transcript + video available).
2. Recruiter records an initial judgment: advance / hold / reject, with a one-sentence reason. **The AI panel is collapsed.**
3. Recruiter clicks "Show AI observations" — Tier 1 evidence appears.
4. If the recruiter's judgment differs from what the evidence suggests, the UI prompts a brief reflection (not a lecture): "Your initial assessment was X. The observations note Y. What changed your mind, or what didn't?"
5. Final decision logged with both the initial and final judgment.

**Why this works:** It defeats anchoring (the AI can't anchor a judgment that already exists), it creates a measurable divergence signal (how often does evidence change minds? — a quality metric), and it satisfies "meaningful human review" structurally rather than cosmetically.

**Acknowledged cost:** Recruiters will find this slower than a flag-first dashboard. The evidence says the slower workflow is the one that works. Mitigate by making the AI panel genuinely on-demand (one click, not a maze) and by triaging: sessions with zero flags skip the AI panel entirely.

### 2.4 Confidence display standard

**Evidence:**
- Showing confidence *does* calibrate trust (Zhang et al. 2020), but **numeric confidence is treated as reassurance** — scrutiny drops as displayed confidence rises (BRACE framework, 2026).
- Berkeley researchers deliberately chose **categorical (high/medium/low)** over numeric because "percentages can be misinterpreted."
- Gigerenzer: natural frequencies ("8 out of every 1,000") are understood; percentages are not — even by physicians.
- **Base-rate trap:** integrity violations are low-base-rate events. A "95% accurate" detector can be wrong ~99% of the time in practice (Bayes' rule). Never show model accuracy as "probability the candidate cheated."

**Standard:**
- Default: **Low / Medium / High** tiers with the *reasons* visible (which signals, what quality).
- If numeric: **natural frequencies only** — "About 3 in 10 flags like this turn out to reflect real issues" — and it must be the **positive predictive value** (posterior given base rate), never raw model accuracy.
- Always pair with what the number does *not* mean: "This does not mean there is an X% chance the candidate cheated."
- **Missing-data visibility:** "Gaze analysis unavailable for 40% of this session (low lighting)" — per BRACE, pair confidence with evidence-sufficiency.

### 2.5 Language standard

No published study directly tests "detected" vs "observed" phrasing; the standard below is evidence-informed inference from framing-compatibility research and the AI Act's own observational wording.

| DO | DON'T |
|----|-------|
| "Observed," "recorded" | "Detected," "flagged cheating" |
| Event counts: "looked away 12 times during Q2" | Agentive nouns: "suspicious behavior," "integrity violation" |
| Temporal scoping: "between 02:14 and 02:26" | Diagnostic adjectives: "abnormal gaze," "deceptive pause" |
| Explicit uncertainty: "also common when reading notes" | Bare assertions without alternatives |
| Non-verdict footer on every observation | Any language implying a conclusion |

**Wording is a weak lever alone** (Cochrane review: framing effects are small). It must be paired with the structural interventions above — never relied on as the mitigation.

### 2.6 Flag dismissal workflow

**What the recruiter needs to dismiss confidently** (synthesized from SOC-analyst and moderation research):

1. **Evidence pre-assembled on one screen.** 85% of SOC analysts report spending significant time manually assembling evidence per alert. The review screen shows: the observation, timestamped clips, the candidate's interview context, signal-quality notes, and alternative explanations — no tab-hunting.
2. **Base-rate context.** "Of every 100 flags like this, roughly N reflect real issues" (natural frequency, from measured PPV).
3. **Symmetric justification friction.** A one-sentence reason is required to **confirm AND to dismiss**. Critical: if only dismissals require justification, the workflow punishes dissent and manufactures rubber-stamping. Keep it to a sentence — decision fatigue is real.
4. **Full audit trail.** Every accept/modify/reject logged with reviewer identity, timestamp, reason, and the evidence shown at decision time. Random sampling of overrides for QA.
5. **Aggregate outcome feedback.** Show recruiters their own confirm/dismiss rates vs. team average — outcome feedback on *their decisions*, not a lecture about over-trust.

### 2.7 Recruiter onboarding (AI literacy that actually works)

**Key finding — the inverted U:** Horowitz & Kahn (2024): minimal AI knowledge → algorithm *aversion*; **moderate knowledge → maximum overreliance** (Dunning-Kruger); only extensive knowledge → appropriate calibration. **A shallow "AI 101" onboarding can make things worse than nothing.** Recruiters likely land in the dangerous middle.

**What changed behavior in studies:**
- Tutorials on system capabilities **+ worked examples of failures** (Chiang & Yin 2021, 2022)
- **Informing users about potential AI errors** increased verification effort; emphasizing *responsibility* did not change behavior (Kupfer et al. 2023) — teach failure modes, not responsibility
- **Judge-first practice cases** as training: 3–5 cases where the recruiter reviews a flag without seeing the AI verdict, commits a judgment, then sees divergence (Frontiers 2026, metacognition literature)

**Recommended onboarding curriculum:**
1. What the detectors actually measure (signals, not cheating) — 5 min
2. The base rate: most flags are benign, with the natural-frequency number — 3 min
3. The system's known failure modes and blind spots (lighting, accents, neurodivergence, device tiers) — 5 min
4. **3–5 judge-first practice cases** with feedback on divergence — 10 min
5. Where the override lives, and that overrides are **expected, not punished** — 2 min
6. Periodic "blind" cases (AI support withheld) to maintain independent judgment — ongoing, quarterly

---

## Part 3: Recommendations for Rekrut AI

### R1. Calibration protocol (for Rex → architecture, Nova → implementation)

Implement the §1.2 protocol: 15 s device check + 45 s passive ice-breaker + ongoing EWMA re-anchoring. Per-session baselines (not stored). Personal + cohort dual reference. `signal_unavailable` as first-class state rendering "insufficient data" in the recruiter UI.

**PRD mapping:** New FR — "The system SHALL perform a ≤60-second passive calibration before scored questions." New acceptance criterion — "No integrity flag fires on a signal whose warm-up quality was below floor."

### R2. Fusion upgrade (for Rex → architecture)

Replace the hard "≥0.85 + 3+ signals" with the §1.3 design: quality-weighted combination, correlation discounting for shared-sensor signals, adaptive threshold τ(q), and an **"uncertain" band (0.60–0.85) routing to human review**. The current rule becomes the *conservative special case* of this design (all weights = 1, no discounting) — so this is an upgrade path, not a rewrite.

**PRD mapping:** Amend the flagging FR to include the uncertain state and quality-floor exclusion.

### R3. Evidence display (for frontend team)

Implement the §2.2 three-tier design with the §2.5 language standard and §2.4 confidence standard. **Do not build a single "integrity score."** Do not show raw sensor data by default. Every observation carries the non-verdict footer.

### R4. Judge-first workflow (for Rex → architecture, frontend team)

Implement the §2.3 workflow: recruiter records initial judgment with AI panel collapsed → explicit "Show AI observations" reveal → divergence reflection prompt → final decision logged with both judgments. Sessions with zero flags skip the AI panel.

**Acknowledged tradeoff:** slower per-review. Mitigate with triage (no-flag sessions skip) and one-click reveal. Do not make the AI panel the default view to "save time" — the evidence says the default view determines the outcome.

### R5. Dismissal workflow (for frontend team)

Per §2.6: pre-assembled evidence screen, base-rate context in natural frequencies, **symmetric one-sentence justification** (confirm and dismiss), full audit trail, aggregate outcome feedback per recruiter.

### R6. Onboarding (for Quinn → QA, Relay → release)

Per §2.7: failure-mode-first curriculum with judge-first practice cases. No checkbox videos. Quarterly blind cases. Track onboarding completion as a launch-readiness gate: **recruiters who haven't completed onboarding cannot access integrity features.**

### R7. Metrics dashboard (for Rex → architecture, Quinn → QA)

| Metric | Definition | Target / Alert |
|--------|------------|----------------|
| Flag rate | % of sessions with ≥1 flag | Track by mode; alert if >15% (tuning signal) |
| Dismissal rate | % of flags dismissed by recruiters | Healthy range 30–70%; <20% suggests rubber-stamping |
| Confirm rate | % of flags confirmed | Correlate with dismissal rate; both low = noise |
| Judge divergence rate | % of reviews where AI evidence changed the initial judgment | Track; sudden drops suggest reviewers stopped engaging |
| Subgroup flag ratio | Flag rate by accommodation status / device tier / lighting | Alert if any subgroup >2× baseline |
| Time-to-decision | Median review time per flag | Alert if <30 s (skimming) |
| Override audit sample | Random 5% of decisions re-reviewed | Quarterly |
| Positive predictive value | Confirmed flags / total flags (validated sample) | Publish internally; feeds the natural-frequency display |

### R8. Accommodation mode (for Aria → PRD, Rex → architecture)

Per §1.5: pre-interview self-declared accommodation step ("help us calibrate to you"), widened movement/speech-timing thresholds, never disabled integrity, never stigmatized. PRD needs a new FR; architecture needs the threshold-parameterization.

---

## Part 4: Compliance Flags (for legal review before Phase 3)

1. **🚨 EU AI Act Article 5 — emotion recognition prohibition.** Inferring emotions from facial expressions or voice in workplace/education contexts is a **prohibited practice** (in force since Feb 2025). Sumanth's vision includes "facial expressions… emotional intelligence" analysis. **Recommendation:** scope behavioral analysis to exclude affect/emotion inference for EU deployments, pending counsel's reading of the official Art. 5 text. (Found via practitioner HR addendum; verify against statute.)
2. **Meaningful human review (GDPR Art. 22, EU AI Act Art. 14).** The judge-first workflow (§2.3) plus symmetric justification (§2.6) plus audit trail is designed to satisfy this structurally. "Reviewer viewed the flag" does not count — the human must be able and willing to depart from the recommendation, and must sometimes do so (ICO guidance).
3. **Voiceprint storage.** Per-session baselines avoid storing voiceprints across interviews. If cross-session personalization is ever added, voiceprints are special-category data under GDPR — separate consent and DPIA required.

---

## Open Questions for Sumanth / Rex

| # | Question | For |
|---|----------|-----|
| 1 | Approve the judge-first workflow (§2.3), accepting slower per-review times? | Sumanth (product) |
| 2 | Approve **no single "integrity score"** — observations only, per §2.2? | Sumanth (product) |
| 3 | Scope check: does "behavioral analysis like a psychologist" include emotion inference? If yes, EU deployment needs legal review **before** Phase 3 (§4.1) | Sumanth + legal |
| 4 | Subgroup flag-rate audit threshold: is 2× baseline the right alert bar, or should it be tighter? | Sumanth (product) |
| 5 | Should accommodation-mode selections be visible to recruiters, or kept private to avoid influencing judgment? (Researcher leans private — selective-adherence risk.) | Sumanth (product) |
| 6 | Fusion: quality-weighted + uncertain band (§1.3) — approve as the v1 design, or ship the simpler current rule first and upgrade post-launch? | Rex (architect) |

---

## Sources

**False positives & proctoring:**
- SoftwareSecure/PSI whitepaper, "Eyes on Integrity" (via eCampusNews): https://www.ecampusnews.com/files/2016/06/Eyes-on-Integrity-A-Comparative-Look-at-Online-Proctoring-Models-eBook-June-2016.pdf
- Raj, Narayanan & Bijlani (2015), auto-proctoring accuracy study (8% FP): https://academic-publishing.org/index.php/ejel/article/download/2600/2083
- ProctorU abandons AI-only proctoring (2021): https://www.insidehighered.com/news/2021/05/24/proctoru-abandons-business-based-solely-ai
- Honorlock voice detection / blended proctoring: https://www.fierce-network.com/more-education-news/can-online-proctoring-improve-student-testing-experience
- Stanford HAI on AI-detector bias vs. non-native English: via https://lynote.ai/blog/is-turnitin-ai-detector-accurate
- Moira Olmsted / Adelphi case (2026): https://www.linkedin.com/posts/usman-abdullahi-27ba34198_a-student-submitted-an-essay-she-wrote-by-activity-7475561361700454400-Z8NR
- Griffith University FP/detection tradeoff proof (arXiv preprint, 2026): via same LinkedIn post
- LLM contextual FP reduction: https://www.enfuse-solutions.com/reducing-false-positives-in-ai-proctoring-with-llm-based-contextual-analysis/
- S.T.O.P. on disability and proctoring: https://www.stopspying.org
- Swauger essay, Inside Higher Ed: https://www.insidehighered.com/blogs/university-venus/unfeeling-ai-and-assessment
- DOJ SafeRent $2.3M settlement: https://www.techpolicy.press/when-algorithms-learn-to-discriminate-the-hidden-crisis-of-emergent-ableism/

**Calibration & fusion:**
- Enhanced Gaze Tracker, Springer (2026), 30 s → +10–20%: https://link.springer.com/chapter/10.1007/978-3-032-25038-4_19
- Calibration duration trade-off, MDPI Appl. Sci.: https://www.mdpi.com/1995-8692/10/5/31
- Eye-tracking drift, PubMed: https://pubmed.ncbi.nlm.nih.gov/30188843/
- Adaptive thresholding, PMC (2026): https://pmc.ncbi.nlm.nih.gov/articles/PMC12473775/
- Face image quality survey, arXiv: https://arxiv.org/pdf/2009.01103
- Biometric fusion survey, arXiv: https://arxiv.org/pdf/1902.02919
- Reliability-Aware Dynamic Score Fusion, MDPI Electronics (2026): https://www.mdpi.com/2079-9292/15/12/2612
- Confidence-Aware Gated Fusion, MDPI Sensors (2026): https://www.mdpi.com/1424-8220/26/8/2454
- Dynamic Belief Fusion, arXiv: https://arxiv.org/pdf/1511.03183
- DST banking biometrics, PMC: https://pmc.ncbi.nlm.nih.gov/articles/PMC8951111/
- Phonexia voice biometrics (20 s enrollment): https://www.phonexia.com/blog/7-benefits-of-voice-biometric-authentication-in-call-centers/
- VoiceVault (10 s enrollment): https://www.secureidnews.com/news-item/breaking-down-voice-biometrics/2/

**Automation bias & human-AI collaboration:**
- Buçinca, Malaya & Gajos (2021), "To Trust or to Think": https://arxiv.org/pdf/2102.09692
- Dratsch et al. (2023), *Radiology* (mammography): https://pubs.rsna.org/doi/10.1148/radiol.222176
- *AI & Society* (2026) systematic review: https://link.springer.com/content/pdf/10.1007/s00146-025-02422-7.pdf
- Parasuraman & Manzey mechanisms (INDECS 2021): https://indecs.eu/2021/indecs2021-pp542-560.pdf
- Zhang et al. (2020) FAT* (confidence & trust): http://arxiv.org/pdf/2001.02114v1
- *Survey of AI Reliance* (judge-advisor paradigm): https://arxiv.org/pdf/2408.03948v2
- Frontiers (2026), judge-first reduces misleading-AI uptake: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1936522/full
- Frontiers (2026), reflection prompts & AI literacy: https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2026.1926110/full
- arXiv (2026), "Think Before You Accept": https://arxiv.org/html/2609.23936
- HBS/MIT/UW (2026) via Computerworld (narrative explanations degrade judgment): https://www.computerworld.com/article/4211682/when-ai-explains-its-decision-humans-may-stop-thinking-independently-2.html
- Gigerenzer natural frequencies: https://home.cs.colorado.edu/~martin/Csci6402/Papers/gg03.pdf
- Berkeley categorical-confidence capstone: https://www.ischool.berkeley.edu/sites/default/files/sproject_attachments/humanai_capstonereport-final.pdf
- BRACE clinical framework (2026): https://www.frontiersin.org/journals/digital-health/articles/10.3389/fdgth.2026.1887161/full
- Alon-Barkat & Busuioc (2023), selective adherence: via Frontiers (2022) https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2022.895997
- COMPAS (AI & Law): https://link.springer.com/article/10.1007/s10506-024-09389-8
- Law Society agentic-AI report (rubber-stamping): https://www.globallegalinsights.com/news/law-society-warns-justice-system-is-unprepared-for-agentic-ai/
- PAIR Guidebook patterns: https://pair.withgoogle.com/guidebook/patterns
- Queen's summary (CFFs, second opinions): https://smith.queensu.ca/insight/content/Why-Humans-and-AI-Assists.php
- Horowitz & Kahn (2024), AI literacy inverted-U: via Springer review above
- SOC alert fatigue: https://www.helpnetsecurity.com/2023/07/20/soc-analysts-tools-effectiveness/
- GDPR Art. 22 explainer: https://gdprinfo.eu/gdpr-article-22-explained-automated-decision-making-profiling-and-your-rights
- EU AI Act Art. 14 explainer: https://agenticcontrolplane.com/blog/eu-ai-act-article-14-ai-agent-delegation-chains
- EU AI Act HR addendum (Art. 5 emotion recognition): https://github.com/dishine-digital-agency/ai-compliance-framework
- Base-rate neglect: https://dev.to/robat_das_3c6e956212f6408/base-rate-neglect-why-your-95-accurate-alert-is-wrong-99-of-the-time-24g2

---

*Research completed 2026-10-10. Two specialist subagents (false-positive reduction; automation-bias/recruiter UX) plus direct web research. Skills consulted: smart-sdlc technical-research (methodology), agency-agents design-ux-researcher, design-persona-walkthrough, product-behavioral-nudge-engine. Speculative items marked as such throughout.*

---

## Appendix: Operational Problem Playbook

**Added:** 2026-10-10 per Sumanth's request ("how shall we do? if we have problems then?")
**Status:** Operational procedures to be formalized as PRD requirements in Phase 2.

### Problem 1: Candidate Disputes a Flag ("I Was Wrongly Flagged")

1. Candidate clicks **"Request Review"** in their report → case enters recruiter review queue
2. Recruiter sees flag + evidence + candidate's explanation side by side
3. Recruiter decides: **uphold**, **dismiss** (with one-sentence reason), or **request re-interview**
4. If dismissed: flag removed from candidate record; system logs dismissal for FP tracking
5. **SLA:** 48 hours. No action → auto-escalates to platform admin
6. Every dismissal feeds the false-positive dashboard; flag types dismissed >50% get retuned or removed

### Problem 2: Recruiter Misuses Flags (Auto-Reject on Flag Count)

1. **Judge-first workflow** enforced in UI — recruiter records own assessment before AI flags are revealed (cannot skip)
2. If recruiter judgment differs from AI: "Your assessment was X, AI flagged Y. What changed?" — one sentence required
3. **Pattern detection:** recruiter dismissing 90%+ or confirming 90%+ without evidence review → flagged for platform review
4. **No bulk actions** on flagged candidates — each requires individual review

### Problem 3: Systemic False Positive Pattern

1. **Dashboard alerts trigger first:**
   - Flag rate >15% for any signal type → investigate
   - Dismissal rate >50% for a signal type → auto-quarantine that signal
   - Subgroup flag ratio >2× → bias alert, immediate review
2. **Quarantine, don't delete:** bad signal stops generating flags but keeps collecting data for retuning
3. **Weekly review:** CTO reviews metrics dashboard every Monday; monthly report to founder

### Problem 4: Legal/Compliance Challenge

1. Every flag has full **audit trail:** observation, timestamp, confidence, signals, recruiter decision, candidate response
2. **BIPA/GDPR data export:** candidate downloads everything via automated endpoint
3. **Legal hold:** one-click complete case file export
4. 10 legal questions from compliance blueprint go to counsel **before Phase 3**

### Problem 5: Unanticipated Edge Cases

1. **Accommodation mode:** candidate opts into "help us calibrate to you" → wider thresholds, same monitoring
2. **Manual override always available:** recruiter can dismiss ANY flag with reason; no flag permanent without human confirmation
3. **Feedback loop:** all overrides logged; monthly review asks "Is the AI wrong or are recruiters wrong?"

### Design Principle

**No single point of failure.** Every risk has ≥2 safety nets:

| Risk | Safety Net 1 | Safety Net 2 |
|------|-------------|-------------|
| False positive | Calibration + conservative thresholds | Candidate appeal + recruiter dismissal |
| Recruiter misuse | Judge-first workflow | Pattern detection + no bulk reject |
| Systemic bias | Dashboard alerts | Signal quarantine |
| Legal challenge | Audit trail | Counsel review before Phase 3 |
| Unknown edge cases | Accommodation mode | Manual override |
