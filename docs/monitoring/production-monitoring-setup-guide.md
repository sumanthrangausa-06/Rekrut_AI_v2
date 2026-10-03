# Rekrut AI — Production Monitoring Setup Guide

> **Date:** June 5, 2026  
> **Owner:** Kimi (Coordinator) + Suga (CTO)  
> **Purpose:** Step-by-step guide to set up Sentry + Datadog for production monitoring

---

## 1. Sentry — Error Tracking & Performance Monitoring

### 1.1 Install Sentry SDK

```bash
npm install @sentry/react @sentry/node
```

### 1.2 Frontend Setup (React)

Add to `src/main.tsx` or `src/index.tsx`:

```typescript
import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: process.env.VITE_SENTRY_DSN,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.replayIntegration({
      maskAllText: false,
      blockAllMedia: false,
    }),
  ],
  tracesSampleRate: 1.0, // Reduce to 0.1 in production after stable
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1.0,
  environment: process.env.VITE_APP_ENV || "development",
  beforeSend(event) {
    // Sanitize sensitive data
    if (event.request?.headers) {
      delete event.request.headers["Authorization"];
      delete event.request.headers["Cookie"];
    }
    return event;
  },
});
```

### 1.3 Backend Setup (Node.js/Express)

Add to `server/index.ts`:

```typescript
import * as Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
  environment: process.env.NODE_ENV || "development",
});

// Add Sentry error handler AFTER all routes
app.use(Sentry.Handlers.errorHandler());
```

### 1.4 Add Error Boundaries (React)

Create `src/components/ErrorBoundary.tsx`:

```typescript
import * as Sentry from "@sentry/react";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    Sentry.captureException(error, { extra: errorInfo });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-fallback">
          <h2>Something went wrong</h2>
          <button onClick={() => window.location.reload()}>Refresh</button>
        </div>
      );
    }
    return this.props.children;
  }
}
```

### 1.5 Environment Variables

```
VITE_SENTRY_DSN=https://xxx@yyy.sentry.io/zzz
SENTRY_DSN=https://xxx@yyy.sentry.io/zzz
SENTRY_AUTH_TOKEN=your_auth_token_for_source_maps
```

---

## 2. Datadog — Infrastructure & Application Monitoring

### 2.1 Install Datadog Agent (Render)

Add to `render.yaml`:

```yaml
services:
  - type: web
    name: rekrut-api
    env: docker
    dockerfilePath: ./Dockerfile
    envVars:
      - key: DD_API_KEY
        sync: false
      - key: DD_SITE
        value: datadoghq.com
      - key: DD_ENV
        value: production
      - key: DD_SERVICE
        value: rekrut-api
      - key: DD_VERSION
        value: ${RENDER_GIT_COMMIT}
```

### 2.2 APM (Application Performance Monitoring)

Install Datadog tracer:

```bash
npm install dd-trace
```

Add to `server/index.ts`:

```typescript
import tracer from "dd-trace";

tracer.init({
  service: "rekrut-api",
  env: process.env.NODE_ENV,
  version: process.env.RENDER_GIT_COMMIT,
  logInjection: true,
  runtimeMetrics: true,
});
```

### 2.3 Custom Metrics

Track business metrics:

```typescript
import { StatsD } from "node-statsd";

const client = new StatsD({
  host: "localhost",
  port: 8125,
  prefix: "rekrut.",
});

// Track key events
client.increment("user.signup", 1, ["role:candidate"]);
client.increment("job.apply", 1, ["job_id:123"]);
client.timing("api.response_time", 250, ["endpoint:/jobs"]);
client.gauge("active_sessions", 150);
```

### 2.4 Database Query Monitoring (Neon/PostgreSQL)

Enable query logging in Neon dashboard:
- Go to Neon Console → Settings → Monitoring
- Enable slow query logging (threshold: 200ms)
- Set up log drain to Datadog

### 2.5 Alert Rules (Critical)

| Metric | Threshold | Action |
|--------|-----------|--------|
| API Error Rate | > 5% for 5 min | Page Suga + Ranga |
| API Response Time | > 500ms for 10 min | Alert Slack #engineering |
| Database Connections | > 80% of pool | Auto-scale warning |
| 5xx Errors | > 10 in 5 min | Page immediately |
| AI Provider Failures | > 3 in 10 min | Alert + fallback check |
| Stripe Webhook Failures | > 1 in 15 min | Alert + manual check |

---

## 3. Health Check Endpoint

Add to `server/routes/health.ts`:

```typescript
import { Router } from "express";
import { Pool } from "pg";

const router = Router();

router.get("/health", async (req, res) => {
  const checks = {
    database: false,
    ai_providers: false,
    stripe: false,
    memory: false,
  };

  // Database check
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    await pool.query("SELECT 1");
    checks.database = true;
    await pool.end();
  } catch (e) {
    console.error("Database health check failed", e);
  }

  // AI Provider check (quick ping)
  try {
    const response = await fetch("https://api.openai.com/v1/models", {
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
    checks.ai_providers = response.status === 200;
  } catch (e) {
    // Try fallback provider
    checks.ai_providers = false;
  }

  // Stripe check (test mode ping)
  try {
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    await stripe.customers.list({ limit: 1 });
    checks.stripe = true;
  } catch (e) {
    checks.stripe = false;
  }

  // Memory check
  const used = process.memoryUsage();
  checks.memory = used.heapUsed < 500 * 1024 * 1024; // < 500MB

  const allHealthy = Object.values(checks).every(Boolean);

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? "healthy" : "degraded",
    checks,
    timestamp: new Date().toISOString(),
    version: process.env.RENDER_GIT_COMMIT || "unknown",
  });
});

export default router;
```

---

## 4. Log Aggregation

### 4.1 Structured Logging (Pino)

```bash
npm install pino pino-pretty
```

```typescript
import pino from "pino";

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: process.env.NODE_ENV !== "production" 
    ? { target: "pino-pretty" } 
    : undefined,
  base: {
    service: "rekrut-api",
    version: process.env.RENDER_GIT_COMMIT,
  },
});

// Usage
logger.info({ userId: "123", action: "job_apply" }, "User applied to job");
logger.error({ error: err.message, stack: err.stack }, "Payment failed");
```

### 4.2 Log Drain to Datadog (Render)

In Render dashboard:
1. Go to Service → Settings → Log Streams
2. Add Log Stream → Datadog
3. Enter Datadog API Key
4. Set source: `rekrut`, service: `rekrut-api`

---

## 5. Setup Checklist

- [ ] Create Sentry project (rekrut-frontend, rekrut-backend)
- [ ] Add Sentry DSN to environment variables
- [ ] Install Sentry SDKs
- [ ] Add React Error Boundary
- [ ] Configure source maps upload in CI/CD
- [ ] Create Datadog account
- [ ] Install Datadog agent on Render
- [ ] Add APM tracing to backend
- [ ] Set up custom metrics for business events
- [ ] Configure alert rules in Datadog
- [ ] Add health check endpoint
- [ ] Set up structured logging with Pino
- [ ] Configure log drain to Datadog
- [ ] Test alerts (trigger a fake error)
- [ ] Document runbook for on-call

---

## 6. Runbook — Common Issues

| Issue | Check | Fix |
|-------|-------|-----|
| 5xx errors spike | Sentry + Datadog APM | Check AI provider status, check DB connections |
| Slow job search | Datadog DB metrics | Check pgvector index, check query plan |
| AI interview fails | Sentry error trace | Check provider circuit breaker, check R2 storage |
| Signup drop | Datadog funnel metrics | Check Stripe webhook, check email deliverability |
| Memory leak | Datadog infra metrics | Restart service, check for unclosed DB connections |

---

*Ready for Suga to implement. Estimated time: 2 days.*