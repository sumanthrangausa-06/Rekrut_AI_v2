# Rekrut AI - Project Hierarchy

## Structure (32 Agents)

```markdown
                          👤 YOU (HEAD/OWNER)
                                 │
                                 │ ultimate authority
                                 ▼
                         ┌───────────────┐
                         │   CEO AGENT   │ ← Project Manager (1)
                         │ (1 Agent)     │
                         └───────┬───────┘
                                 │
                    ┌────────────┴────────────┐
                    │                         │
                    ▼                         ▼
          ┌─────────────────┐       ┌──────────────────┐
          │   CTO AGENT     │       │  BUSINESS LEADS  │
          │ (1 Agent)       │       │  (5 Agents)       │
          │ - Technical     │       │ - Product        │
          │ - Architecture  │       │ - Marketing      │
          │ - Code Quality  │       │ - Sales          │
          └───────┬─────────┘       │ - CS             │
                  │                 │ - Finance        │
         ┌────────┴────────┐         └────────┬─────────┘
         │                 │                  │
         ▼                 ▼                  ▼
  ┌─────────────┐  ┌─────────────┐    ┌─────────────┐
  │ TECHNICAL   │  │ TECHNICAL   │    │ BUSINESS    │
  │ SENIORS (5)│  │ WORKERS(19) │    │ WORKERS     │
  │            │  │            │    │             │
  │ - Backend  │  │            │    │             │
  │ - Frontend │  │            │    │             │
  │ - QA       │  │            │    │             │
  │ - DevOps   │  │            │    │             │
  │ - AI/ML    │  │            │    │             │
  └─────────────┘  └─────────────┘    └─────────────┘
```

## Agent List

### LAYER 1: Leadership (2)

| ID | Name | Role | Reports To | Frequency |
| --- | --- | --- | --- | --- |
| ceo | CEO Agent | Project Manager | YOU | DAILY |
| cto | CTO Agent | Technical Lead | CEO | DAILY |

### LAYER 2: Technical Seniors (5)

| ID | Name | Role | Reports To | Frequency |
| --- | --- | --- | --- | --- |
| sr-backend | Senior Backend | API, Database | CTO | DAILY |
| sr-frontend | Senior Frontend | UI/UX | CTO | DAILY |
| sr-qa | Senior QA | Testing, Quality | CTO | DAILY |
| sr-devops | Senior DevOps | Deployments, Infra | CTO | DAILY |
| sr-aiml | Senior AI/ML | OmniScore, AI | CTO | DAILY |

### LAYER 3: Technical Workers (19)

#### Backend Workers (5)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-api | Worker API | REST APIs | Senior Backend |
| wr-auth | Worker Auth | Login, Register | Senior Backend |
| wr-jobs | Worker Jobs | Job Management | Senior Backend |
| wr-candidates | Worker Candidates | Candidate Mgmt | Senior Backend |
| wr-screening | Worker Screening | AI Screening | Senior Backend |

#### Frontend Workers (5)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-dashboard | Worker Dashboard | Recruiter Dashboard | Senior Frontend |
| wr-forms | Worker Forms | Job/Candidate Forms | Senior Frontend |
| wr-reports | Worker Reports | Analytics Reports | Senior Frontend |
| wr-mobile | Worker Mobile | Mobile Responsive | Senior Frontend |
| wr-design | Worker Design | UI/UX Design | Senior Frontend |

#### QA Workers (3)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-qa-manual | Worker QA Manual | Manual Testing | Senior QA |
| wr-qa-auto | Worker QA Auto | Automated Tests | Senior QA |
| wr-qa-perf | Worker QA Perf | Performance Tests | Senior QA |

#### DevOps Workers (3)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-cicd | Worker CI/CD | Build & Deploy | Senior DevOps |
| wr-monitor | Worker Monitor | Monitoring | Senior DevOps |
| wr-security | Worker Security | Security | Senior DevOps |

#### AI/ML Workers (2)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-omniscor | Worker OmniScore | Scoring System | Senior AI/ML |
| wr-chatbot | Worker Chatbot | AI Chatbot | Senior AI/ML |

#### Research Worker (1)

| ID | Name | Role | Reports To |
| --- | --- | --- | --- |
| wr-research | Worker Research | Market Research | Senior Backend |

### LAYER 4: Business Leads (5)

| ID | Name | Role | Reports To | Frequency |
| --- | --- | --- | --- | --- |
| lead-product | Product Manager | Features, Roadmap | CEO | DAILY |
| lead-marketing | Marketing Lead | Growth, SEO | CEO | DAILY |
| lead-sales | Sales Lead | Outreach, Partners | CEO | DAILY |
| lead-cs | Customer Success | Support, Retention | CEO | DAILY |
| lead-finance | Finance Lead | Budget, Metrics | CEO | DAILY |

## Approval Workflow

```markdown
WORKER → SENIOR → CTO → CEO → YOU
              ↓
         ROUTINE? 
              ↓
         YES → Auto-approve → Auto-deploy
         NO → Escalate to CTO → CEO → YOU
```

## MCP Tools Access

| Tool | Who Can Use | Approval Needed |
| --- | --- | --- |
| Render | CTO, Senior DevOps | CTO for prod |
| Neon | CTO, Senior Backend | CTO for schema |
| GitHub | All agents | CTO for write |
| Gmail | CEO, Business Leads | CEO approval |
| Discord | CEO, All Leads | CEO approval |
