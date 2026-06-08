# Bundle Optimization Report — Rekrut AI Client

## Problem

Build warning: the main JS chunk was **1,564.22 kB** (raw) / **341.53 kB** gzipped, far exceeding Vite’s 600 kB warning threshold. All route-level pages were imported statically in `App.tsx`, forcing the entire application into a single entry chunk.

## Solution

### 1. Route-level code splitting (`React.lazy`)

Converted every route-level page in `src/App.tsx` from static imports to `React.lazy()` dynamic imports. This causes Vite / Rollup to emit a separate chunk for each page that is only fetched when the user navigates to that route.

- **84 page components** were lazy-loaded.
- A single `Suspense` boundary with a `PageLoading` fallback wraps the route tree so the app shows a consistent loading state while chunks are being fetched.
- Named exports are handled via `.then(m => ({ default: m.PageName }))` because all pages export named components rather than default exports.

### 2. Vendor chunking (`manualChunks`)

Replaced the hard-coded `manualChunks` object with a function that splits common runtime libraries into dedicated chunks:

- `react` — core React library  
- `react-dom` — renderer (~180 kB raw)  
- `router` — `react-router-dom`  
- `vendor` — catch-all for any other `node_modules`  

This prevents third-party code from being duplicated into every page chunk and keeps the entry `index` chunk minimal.

### 3. Chunk file naming

Added `entryFileNames`, `chunkFileNames`, and `assetFileNames` patterns so all emitted assets land under `assets/` with predictable `[name]-[hash]` naming.

## Results

| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Main index chunk (raw) | **1,564.22 kB** | **46.11 kB** | **-97 %** |
| Main index chunk (gzip) | **341.53 kB** | **11.61 kB** | **-97 %** |
| Build warnings | ⚠️ > 600 kB warning | ✅ None | — |
| Total JS chunks | 4 | 60+ | Fine-grained splitting |

Largest individual chunks after optimization:
- `react-dom` — 180.89 kB / 56.44 kB gz (shared across all routes)
- `react` — 85.98 kB / 17.98 kB gz (shared across all routes)
- `ai-coaching` — 125.89 kB / 25.46 kB gz (only loaded when visiting the AI coaching page)
- `onboarding` — 84.47 kB / 18.76 kB gz (only loaded when visiting onboarding)

## Files Changed

- `src/App.tsx` — lazy-loaded all pages; added `Suspense` + `PageLoading` fallback  
- `vite.config.ts` — switched `manualChunks` to function-based vendor splitting; added output naming rules  

## Build Status

✅ `npm run build` completes cleanly with **zero warnings**.
