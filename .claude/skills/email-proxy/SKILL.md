---
name: email-proxy
description: "Send and receive emails through Polsia's authenticated email proxy endpoints."
---

# Email Proxy

Send and receive emails using Polsia's email proxy. Every company gets `{slug}@polsia.app`.

## Base URL

```
https://polsia.com/api/proxy/email
```

## Authentication

```javascript
headers: {
  'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
}
```

## Send Email

```javascript
await fetch('https://polsia.com/api/proxy/email/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
  },
  body: JSON.stringify({
    to: 'user@example.com',
    subject: 'Hello',
    body: 'Plain text content (required)',
    html: '<p>HTML content</p>',  // Optional: HTML version
    reply_to_email_id: 123,  // Optional: pass inbound email ID to bypass rate limit
    transactional: true  // Optional: bypass rate limit for internal app emails (alerts, notifications)
  })
});
```

**Important:** Use `body` (not `text_body`) for sending. The `html` field is optional but recommended for formatted emails like magic links.

## Read Inbox

```javascript
const res = await fetch('https://polsia.com/api/proxy/email/inbox', {
  headers: { 'Authorization': `Bearer ${process.env.POLSIA_API_KEY}` }
});
const { emails } = await res.json();
// Each email has an 'id' - use it as reply_to_email_id when replying
```

## Inbound Email Webhook

Emails to `{slug}@polsia.app` trigger your `/api/webhook/email` endpoint:

```javascript
app.post('/api/webhook/email', async (req, res) => {
  // Note: Inbound emails use text_body/html_body (different from send API)
  const { from, subject, text_body, html_body, email_id } = req.body;

  // Process the email...

  // Reply (bypasses rate limit):
  // Note: Send API uses body/html (not text_body/html_body)
  await fetch('https://polsia.com/api/proxy/email/send', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
    },
    body: JSON.stringify({
      to: from,
      subject: `Re: ${subject}`,
      body: 'Thanks for your email!',  // Use 'body' not 'text_body'
      html: '<p>Thanks for your email!</p>',  // Optional HTML version
      reply_to_email_id: email_id  // Bypasses rate limit
    })
  });

  res.json({ success: true });
});
```

**Field name reference:**
| Direction | Text field | HTML field |
|-----------|------------|------------|
| Sending (POST /send) | `body` | `html` |
| Receiving (webhook) | `text_body` | `html_body` |

## Rate Limits

| Type | Limit |
|------|-------|
| Cold outreach (new recipients) | 2/day |
| Replies to inbound emails | Unlimited (pass `reply_to_email_id`) |
| Known contacts | Unlimited |
| **Transactional/Internal** | **Unlimited** (pass `transactional: true`) |

API returns 429 error if limit exceeded.

### When to use `transactional: true`

For **internal app emails** that your users requested or expect:
- Account verification / magic links
- Password resets
- **Internal notifications/alerts** (medication alerts, safety notices, system alerts)
- Order confirmations
- Appointment reminders
- Any email to registered users of your app

These are NOT cold outreach - the recipient is a registered user expecting this email.

```javascript
await fetch('https://polsia.com/api/proxy/email/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.POLSIA_API_KEY}`
  },
  body: JSON.stringify({
    to: 'staff@hospital.com',
    subject: 'Medication Alert',
    body: 'Patient requires attention...',
    transactional: true  // Bypasses cold outreach limit
  })
});
```

## DO NOT

- Set up separate email services (SendGrid, Postmark, etc.)
- Use the company's own SMTP credentials
- Build custom email infrastructure

Use the Polsia email proxy - it's already configured for your company.
