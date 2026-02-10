# Agent SDK

Build AI agents that work autonomously for end users. Every Polsia company can be an AI company.

**Default:** Opus 4.6 with extended thinking. Polsia handles model selection and turn limits.

## MANDATORY: All AI Features Must Use Polsia API

**NEVER implement AI directly in company apps. Not now, not later.**

This means:
- NO `anthropic.messages.create()`
- NO `openai.chat.completions.create()` for AI features (only allowed for OCR/embeddings)
- NO direct Claude API calls
- ONLY use Polsia API endpoints

**Why?** Company apps are autonomous. Polsia MUST have visibility into all AI usage for:
- Debugging when things go wrong
- Cost tracking and billing
- Prompt injection for bug reporting
- Monitoring and rate limiting

## Setup

Create `lib/polsia-ai.js` in the company's codebase:

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({
  baseURL: process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai',
  apiKey: process.env.POLSIA_API_KEY,
});

// Simple chat - Polsia handles model selection
// Pass subscriptionId to track usage per end-user subscription
async function chat(message, options = {}) {
  const response = await anthropic.messages.create({
    max_tokens: options.maxTokens || 8192,
    messages: [{ role: 'user', content: message }],
    system: options.system,
  }, {
    headers: options.subscriptionId ? { 'X-Subscription-ID': options.subscriptionId } : {}
  });
  return response.content[0].text;
}

// Agent with tools - Polsia handles model and turn limits
// Pass subscriptionId to track usage per end-user subscription
async function runAgent(prompt, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`,
  };
  // Track which end-user's subscription is being used
  if (options.subscriptionId) {
    headers['X-Subscription-ID'] = options.subscriptionId;
  }

  const response = await fetch(
    `${process.env.POLSIA_API_URL || 'https://polsia.com/api/proxy/ai'}/agent/run`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        prompt,
        mcpServers: options.mcpServers || [],
      }),
    }
  );
  return response.json();
}

module.exports = { anthropic, chat, runAgent };
```

Add to package.json:
```json
"@anthropic-ai/sdk": "^0.30.0"
```

## Environment Variables

Polsia automatically injects these env vars into deployed apps:

| Variable | Description |
|----------|-------------|
| `POLSIA_API_KEY` | Your API key for all Polsia proxy services (AI, R2, Email) |
| `POLSIA_API_URL` | Base URL for the AI proxy (`https://polsia.com/api/proxy/ai`) |

**Note:** `POLSIA_API_TOKEN` is deprecated. Always use `POLSIA_API_KEY`.

## Subscription Tracking (For Apps with Paid Users)

When your app charges end-users for AI features via Stripe, **you MUST pass the subscription ID** so Polsia can track usage per subscriber.

**How it works:**
1. End-user subscribes via your Stripe checkout (Polsia syncs their `subscription_status` to your `users` table)
2. User logs in and uses AI features
3. Your app passes their `stripe_subscription_id` from the users table to the AI proxy
4. Polsia logs usage against that subscription for billing/analytics

**Usage:**
```javascript
// Get user's subscription from your database
const user = await pool.query('SELECT stripe_subscription_id FROM users WHERE id = $1', [userId]);

// Pass it to AI calls
const result = await chat('Analyze this...', {
  subscriptionId: user.rows[0].stripe_subscription_id  // e.g., 'sub_1234...'
});

// Or for agent runs
const result = await runAgent('Research this topic...', {
  subscriptionId: user.rows[0].stripe_subscription_id
});
```

**Header:** Apps pass `X-Subscription-ID` header. The lib/polsia-ai.js template handles this automatically when you pass `subscriptionId` in options.

**Why?** Enables:
- Per-user usage analytics
- Usage-based billing if needed
- Cost attribution to specific subscribers

## When to Use `chat()` vs `runAgent()`

**Use `chat()` when:**
- Analyzing data the user already provided (uploaded files, form input)
- Generating text from static context
- Simple prompt → response patterns

**Use `runAgent()` when:**
- Agent needs to research real-world information (news, company data, market trends)
- Agent needs to send emails, access calendars, search the web
- Agent needs multi-step tool use with MCP servers
- Building autonomous agents that work without user input

**For Surprise Me autonomous agents:** Almost always use `runAgent()`. Autonomous agents typically need to fetch real-time data (web search, news, APIs), not just reason about static input. If your agent "monitors" or "detects" things in the real world, it needs `runAgent()` with appropriate MCPs.

**Example - WRONG (can't find real news):**
```javascript
// Uses chat() - only has Claude's training data, can't search web
const signals = await chat(`Find recent layoff news for ${company}`);
```

**Example - RIGHT (actually searches the web):**
```javascript
// Uses runAgent() with web_search MCP - finds real-time news
const result = await runAgent(
  `Search for recent layoff announcements at ${company}. Return any signals found.`,
  { mcpServers: ['web_search'], subscriptionId }
);
```

## Available MCPs

Request in `mcpServers` array - Polsia handles OAuth tokens:

- `gmail` - Read/send emails
- `github` - Repository operations
- `slack` - Workspace messaging
- `google_calendar` - Calendar events
- `google_sheets` - Spreadsheet operations

## Auto-Mounted Company MCPs

Every agent run via `/agent/run` automatically has these tools - NO configuration needed:

### `save_data({ type, data })` - Store any data
The agent saves structured data directly to the company's database. No JSON parsing needed.

```javascript
// In your agent prompt:
// "When you find a deal, save it with: save_data({ type: 'deal', data: { name: '...', score: 8 } })"

// Read from your app:
const deals = await pool.query(
  "SELECT data FROM agent_data WHERE type = 'deal' ORDER BY created_at DESC"
);
```

### `send_email({ to, subject, body })` - Send emails
The agent sends emails directly from `{company-slug}@polsia.app`.

## WRONG vs RIGHT

### WRONG - Direct AI call:
```javascript
// DON'T - Polsia has no visibility
import Anthropic from '@anthropic-ai/sdk';
const anthropic = new Anthropic();

const response = await anthropic.messages.create({
  model: 'claude-sonnet-4-20250514',
  messages: [{ role: 'user', content: 'Analyze this data...' }]
});
```

### RIGHT - Polsia API:
```javascript
// DO THIS - Polsia tracks everything
const response = await fetch(`${process.env.POLSIA_API_URL}/agent/run`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
  },
  body: JSON.stringify({
    prompt: 'Analyze this data...'
  })
}).then(r => r.json());
```

## Example: Email Webhook Handler

```javascript
// api/webhook/email.js - Called when emails arrive at {slug}@polsia.app
export async function POST(req) {
  const { from, subject, text_body } = await req.json();

  const { output } = await fetch(`${process.env.POLSIA_API_URL}/agent/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
    },
    body: JSON.stringify({
      prompt: `
        You received an email:
        From: ${from}
        Subject: ${subject}
        Body: ${text_body}

        Analyze this email and draft a helpful response.
      `,
      mcpServers: [{ name: 'gmail' }]
    })
  }).then(r => r.json());

  return Response.json({ processed: true, result: output });
}
```

## Reading Saved Data

The `agent_data` table is automatically created in the company's Neon DB:

```sql
SELECT * FROM agent_data WHERE type = 'trend' ORDER BY created_at DESC;
-- Returns: id, type, data (JSONB), created_at
```

In your app:
```javascript
app.get('/api/trends', async (req, res) => {
  const result = await pool.query(
    "SELECT id, data, created_at FROM agent_data WHERE type = 'trend' ORDER BY created_at DESC LIMIT 10"
  );
  res.json({ trends: result.rows.map(r => ({ id: r.id, ...r.data, created_at: r.created_at })) });
});
```
