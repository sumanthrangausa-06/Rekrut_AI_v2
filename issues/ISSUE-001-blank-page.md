## [DEPLOYMENT] Dev environment shows blank page — JS assets not loading

### Flow
General

### Severity
P0 - Critical (App unusable)

### Description
The dev deployment at https://rekrutai-dev.onrender.com is showing a blank page. The HTML loads but the JavaScript bundle fails to load with a 500 error.

### Steps to Reproduce
1. Open https://rekrutai-dev.onrender.com
2. Wait for page to load
3. Page remains blank
4. Check console → JS assets return 500 error

### Expected Behavior
The React app should load and display the Rekrut AI homepage with all components.

### Actual Behavior
- Blank white page
- Console shows: `Failed to load resource: the server responded with a status of 500 ()` for `/assets/index-BssGYlVp.js`
- CSS also fails: `Refused to apply style... because its MIME type ('text/html') is not a supported stylesheet MIME type`

### Root Cause
The `client/dist` folder had stale asset references. The old JS file `index-DFwxJmR_.js` was deleted but the new file `index-D5u27TUy.js` was not committed to git. The `index.html` references the new file but git doesn't have it.

### Fix Applied
- Rebuilt `client/dist/` with `npm run build`
- Added new assets to git
- Committed: `fix: rebuild dist assets for Render deployment` (4824ef6)
- Pushed to `dev` branch

### Status
**Fix pushed, waiting for Render to redeploy.**

### Environment
- Render (dev branch, auto-deploy enabled)
- Chrome 120
- Windows 11

### Screenshot
[See attached screenshot showing blank page]
