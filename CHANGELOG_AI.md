# LociMyu Update – AI Changelog

## Step 01 – drive.file scope normalization + Picker foundation
**Date:** 2026-01-25

### What changed
1. **Removed restricted Drive scope (`drive.readonly`) from code-defined scopes**
   - Edit boot (`boot.esm.cdn.js`): scopes are now `spreadsheets` + `drive.file`.
   - Share boot (`boot.share.cdn.js`): scopes are now `spreadsheets.readonly` + `drive.file`.

2. **Added Google Picker foundation module**
   - New file: `picker.bridge.js`
   - Provides:
     - `window.__lm_pickerEnsureLoaded()` to load `gapi` + Picker
     - `window.__lm_openPicker(opts)` to open Picker and return selected docs/fileIds
   - Reads API key from (in order): URL params (`lm_api_key`/`api_key`), `window.__LM_API_KEY`, `window.__LM_CONFIG.google.apiKey`, or meta `google-api-key`.
   - Uses OAuth token from `opts.oauthToken` or (default) `window.__lm_getAccessToken()`.

3. **Wired Picker module into both entrypoints**
   - Edit: `app.edit.entry.js` imports `picker.bridge.js`.
   - Share: `app.share.entry.js` imports `picker.bridge.js` and adds it to diagnostics.

4. **Updated strategic guideline**
   - `LociMyu_Update_Requirements.md` bumped to **v1.1** and now includes **Development Process Rules**.

### Why it changed
- Google verification feedback requires minimizing Drive scopes and strongly prefers `drive.file` over restricted scopes.
- Picker is the intended mechanism for explicit file selection under `drive.file`, enabling the upcoming sheet-first architecture without Drive traversal.

### How to test (manual)
1. Deploy/load the updated files and open the app.
2. Confirm the OAuth consent screen no longer shows `drive.readonly`.
3. In DevTools console, run:
   - `await window.__lm_pickerEnsureLoaded()`
   - `await window.__lm_openPicker({ title: 'Pick a spreadsheet', viewId: 'SPREADSHEETS' })`
4. Confirm the Picker UI opens and returns `{ action: 'PICKED', docs: [...] }`.

### Notes / follow-ups
- This step does **not** yet change UX to be sheet-first; it only establishes the minimum-scope baseline and Picker foundation.
- Next step will introduce a sheet-selection UI and route dataset loading through the spreadsheet context.


## Step01a (2026-01-25) Runtime key injection & persistence
- config.js: introduced safe runtime injection/persistence behavior to avoid stale/invalid keys; values can be provided via URL params or config and cached in localStorage.
- picker.bridge.js: API key resolution now supports localStorage persistence (LM_API_KEY) and auto-caches from URL param (lm_api_key/api_key) to avoid re-adding query params each launch.
- No functional change to scopes; still drive.file-first.


## Step01b (2026-01-25) Inject test project keys into config
- config.js: set Google OAuth clientId and Picker API key for the test project (values intentionally not repeated in logs).
- This allows Picker to open without URL parameters once deployed (still supports URL override).
