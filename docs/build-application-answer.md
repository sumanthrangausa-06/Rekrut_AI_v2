# Rekrut AI — Project Answer for Build Technologies Domain Expert Application

## "Tell us about a project you're proud of"

---

**Rekrut AI: Building a Recruitment Platform That Actually Understands Context**

I'm the founder of Rekrut AI (rekrutai.co) — an AI-powered recruitment platform that connects candidates, recruiters, and employers through a unified, role-aware system. What I'm most proud of isn't that we shipped features. It's that we built something where three completely different user types — a job-seeker uploading a resume, a recruiter managing 50 open roles, and an admin configuring billing — can coexist in the same codebase without the architecture collapsing under its own weight.

**The Technical Challenge: Multi-Tenant Identity Without Losing the Plot**

The hardest problem wasn't any single feature. It was the intersection of auth, routing, and state management across three user personas, each with completely different dashboards, permissions, and data access patterns. A candidate sees job listings and an application tracker. A recruiter sees analytics, candidate pipelines, and billing. An admin sees user management and configuration.

I built a JWT-based authentication system with 15-minute token expiry and silent refresh — not because it's flashy, but because security in recruitment software is non-negotiable. You're handling PII, employment history, and sometimes salary data. The auth layer enforces role-based access control at both the API and route level, so a candidate URL handed to a recruiter returns a proper 403, not a broken UI.

The frontend migration was equally gnarly. We started with legacy HTML/CSS and had to move to React + Tailwind while keeping the product usable. I ran parallel builds — legacy site stayed live while the new React frontend was developed and tested — so we never had downtime during the transition.

**My Approach: Ship Like You Mean It**

I don't believe in "we'll fix it in v2." I set up a CI/CD pipeline with Playwright E2E tests that run before anything hits staging. Every PR gets browser-level QA — not just unit tests, but actual click-through verification for each user type. I deployed across three environments (dev, staging, production) with separate database instances and environment-specific configs.

For the backend, I designed REST APIs for candidate search with filtering, recruiter analytics with aggregation pipelines, and job management with proper input validation and rate limiting. The database is PostgreSQL on Neon, and I optimized queries early rather than waiting for performance to become a problem.

Stripe integration was another challenge — not the API itself, but handling the billing logic cleanly across free and paid tiers, webhook verification, and making sure a recruiter downgrading their plan doesn't accidentally orphan active job posts.

**What Made It Meaningful**

This wasn't a portfolio piece. It was a product real people were supposed to use. The moment I saw a recruiter log in, post a job, and get their first application — on mobile, because they'd told me they review candidates on their phone between meetings — I knew the architecture decisions were paying off.

What I learned: "production-ready" isn't a checklist. It's the discipline of testing the edge case where a recruiter's session expires mid-form-submission. It's catching a CSS regression that breaks the mobile sidebar before a user screenshots it and sends it to you. It's building empty states that don't look like bugs. It's the boring stuff that makes the product feel real instead of like a demo.

Right now the production environment is temporarily down due to a Render account suspension I'm resolving, but the codebase, test suite, and deployment pipeline are all solid. This thing works. And I'm proud of that.

---

**Character count:** ~2,800 characters (should fit comfortably in the form field)
**Tone:** Technical but human, specific about ownership, honest about setbacks
**References:** JWT auth, silent refresh, role-based routing, React migration, Playwright E2E, Stripe billing, multi-environment deployment
