# OAuth Redirect URI Configuration — Manual Steps

## Issue #168: Google OAuth "Invalid OAuth state" on Staging

## ✅ Code Fixes Already Applied

1. **Session cookie `sameSite` changed from `strict` to `lax`** (`ed26e09`) — allows session cookie to be sent during OAuth callback
2. **Redirect URI fallback now prefers `BASE_URL` / `APP_URL`** — more reliable behind reverse proxies
3. **Calendar OAuth separated from Auth OAuth** — uses `GOOGLE_CALENDAR_REDIRECT_URI` to avoid conflicts

---

## 🔧 Manual Action Required: Google Cloud Console

You must add the staging redirect URI to your Google OAuth 2.0 client credentials.

### Step 1: Open Google Cloud Console
Go to: https://console.cloud.google.com/apis/credentials

### Step 2: Select the Rekrut AI project
Look for the project containing the OAuth 2.0 Client ID: `260271904114-6kj1519osgaifejj049sedijmsnbvrjt.apps.googleusercontent.com`

### Step 3: Edit the OAuth 2.0 Client
1. Click on the Web application client
2. Under **Authorized redirect URIs**, add ALL of the following:

```
http://localhost:3000/api/auth/google/callback
https://rekrutai-staging.onrender.com/api/auth/google/callback
https://rekrutai-dev.onrender.com/api/auth/google/callback
https://rekrut.ai/api/auth/google/callback
https://rekrut-ai.onrender.com/api/auth/google/callback
```

> ⚠️ **Important**: Each URI must match **exactly** what the app sends. Trailing slashes matter!

### Step 4: Save
Click **Save**. Changes may take a few minutes to propagate.

---

## 🔧 Manual Action Required: LinkedIn Developer Portal

### Step 1: Open LinkedIn Developer Portal
Go to: https://developer.linkedin.com/

### Step 2: Find your app
Look for the app with Client ID: `86s12zy0yzeo9q`

### Step 3: Add Authorized Redirect URLs
Under **Auth** > **OAuth 2.0** > **Authorized redirect URLs**, add:

```
http://localhost:3000/api/auth/linkedin/callback
https://rekrutai-staging.onrender.com/api/auth/linkedin/callback
https://rekrutai-dev.onrender.com/api/auth/linkedin/callback
https://rekrut.ai/api/auth/linkedin/callback
https://rekrut-ai.onrender.com/api/auth/linkedin/callback
```

---

## 🔧 Render Staging Environment Variables (Already Verified ✅)

Checked via Render API — the following are correctly set on `rekrutai-staging`:

| Variable | Value | Status |
|---|---|---|
| `GOOGLE_REDIRECT_URI` | `https://rekrutai-staging.onrender.com/api/auth/google/callback` | ✅ Correct |
| `LINKEDIN_REDIRECT_URI` | `https://rekrutai-staging.onrender.com/api/auth/linkedin/callback` | ✅ Correct |
| `FRONTEND_URL` | `https://rekrutai-staging.onrender.com` | ✅ Correct |
| `NODE_ENV` | `staging` | ✅ Correct |

No Render env var changes needed.

---

## 🔧 Render Production Environment Variables

Ensure these are set on `rekrutai-prod`:

| Variable | Required Value |
|---|---|
| `GOOGLE_REDIRECT_URI` | `https://rekrut.ai/api/auth/google/callback` |
| `LINKEDIN_REDIRECT_URI` | `https://rekrut.ai/api/auth/linkedin/callback` |
| `GOOGLE_CALENDAR_REDIRECT_URI` | `https://rekrut.ai/api/calendar/oauth/callback` |

---

## 🧪 Testing After Configuration

1. Go to `https://rekrutai-staging.onrender.com/login`
2. Click **Sign in with Google**
3. Complete the OAuth flow
4. You should be redirected to `/candidate/dashboard` or `/recruiter/dashboard`

If you still see `?error=Invalid OAuth state`, check:
- Browser dev tools > Application > Cookies — is the `connect.sid` cookie present?
- Network tab — does the callback request include the `state` query param?
- Server logs on Render — any session-related errors?

---

## 📋 Summary of Changes in This Fix

| File | Change |
|---|---|
| `routes/auth.js` | Redirect URI fallback now uses `BASE_URL` / `APP_URL` before dynamic construction |
| `.env.example` | Added separate env vars for auth and calendar Google OAuth |
| `server/services/calendar-service.js` | Uses `GOOGLE_CALENDAR_REDIRECT_URI` to avoid collision with auth redirect URI |
| `docs/OAUTH_REDIRECT_URI_SETUP.md` | This documentation file |
