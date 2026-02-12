---
name: render-infra
description: "Apply Render-specific deployment requirements for Polsia apps, including /health checks and migration strategy."
---

# Render Infrastructure

Polsia apps deploy to Render. This skill covers platform-specific requirements.

## Health Check Endpoint (CRITICAL)

Render services are configured with a health check at `/health`. Your app MUST have this:

```javascript
// Health check - MUST be at /health (not /api/health)
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});
```

**Requirements:**
- Endpoint MUST be at `/health` (root level, NOT under /api)
- Must respond with HTTP 200 status
- If health check fails, deploy times out after 15 minutes
- You'll see "update_failed" status in Render dashboard

## DATABASE_URL Not Available in Build

Render's buildCommand does NOT have access to DATABASE_URL.

**For database migrations:** Run them on server startup:

```javascript
// In server.js - run migrations before app.listen()
async function runMigrations() {
  // Migrations should be idempotent (check if already applied)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL
    )
  `);
}

runMigrations().then(() => {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
```

**NEVER run migrations in Render's buildCommand** - it will fail.

## Frontend Build Configuration

If you create a frontend that requires a build step (React, Vite, etc.):

1. Create the frontend in a subdirectory (e.g., `client/`)

2. Update root package.json build script:
```json
"scripts": {
  "build": "cd client && npm install --include=dev && npm run build"
}
```
**IMPORTANT:** Use `--include=dev` because vite/tailwind are devDependencies.

3. Serve built files from Express:
```javascript
app.use(express.static('client/dist'));
```

## Package.json Rules (CRITICAL)

**Before modifying package.json:**
1. READ the existing file first
2. PRESERVE all existing scripts (especially "build")
3. ADD or UPDATE - never rewrite from scratch

**Required scripts:**
```json
{
  "scripts": {
    "build": "echo 'No build step required'",
    "start": "node server.js"
  }
}
```

If no frontend: `"build": "echo 'No build step required'"`

**NEVER remove the build script** - deploys will fail with "Missing script: build".

With frontend:
```json
"build": "npm run migrate && cd client && npm install --include=dev && npm run build"
```

## File Operations

Before editing any file, verify it exists:
1. Use `glob` or `list_files` to check if the file path exists
2. If file doesn't exist, create it or adjust your approach
3. NEVER attempt to edit a file that doesn't exist

**Syntax verification:**
- Check JS/Node syntax: `node --check file.js` (parses only, no execution)
- Do NOT run `node file.js` to verify syntax - that executes the file

**After modifying package.json:**
- If you added dependencies, run `npm install`
- Skip if you only modified metadata (name, version)

## Filesystem is Ephemeral

Render's filesystem resets on every deploy.

**NEVER use `multer.diskStorage()`** - files will be LOST.

Use R2 proxy for file storage (see R2 Proxy skill).

## Deploy Workflow

```javascript
// Get instance_id
list_instances()

// Push and deploy
push_to_remote({ instance_id, repo_path: ".", wait_for_deploy: false })

// Set env vars if needed
update_env_vars({ instance_id, env_vars: {"KEY": "value"} })
```

**push_to_remote handles EVERYTHING:**
- Auto-commits file changes
- Runs npm install, build, and migrate validation
- Pushes to GitHub and triggers Render deploy

**After push_to_remote succeeds, your job is DONE.** Do not call get_status or get_logs.
