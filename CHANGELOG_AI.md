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


## Step01c (2026-01-25) Fix Picker foundation script parse error
- picker.bridge.js: restored the full Picker foundation implementation and fixed a JavaScript syntax error that prevented app boot.
- getApiKey(): keeps Step01a behavior (URL-param injection + localStorage caching via `LM_API_KEY`) while retaining the complete Step01 Picker module.


## Step 01d – Sheet-first “Open…” UI wiring + drive.file policy flag
**Date:** 2026-01-25

### What changed
1. **Enabled drive.file-only runtime policy**
   - `config.js`: sets `window.__LM_POLICY_DRIVEFILE_ONLY = true;`
   - Effect: disables folder scanning / sibling listing paths in:
     - `glb.btn.bridge.v3.js` (skips `save.locator` pipeline)
     - `caption.images.loader.js` (skips Drive folder image enumeration)

2. **Wired sheet-first dataset opener UI into both entrypoints**
   - `app.edit.entry.js`: imports
     - `picker.bridge.module.js`
     - `dataset.open.ui.js`
   - `app.share.entry.js`: imports
     - `picker.bridge.module.js`
     - `dataset.open.ui.js`

3. **Introduced “Open…” button in the sheet row**
   - `dataset.open.ui.js` injects an `Open…` button into the existing sheet-row.
   - Flow:
     - Opens Picker for a spreadsheet (single-select)
     - Sets `lm:sheet-context` for that spreadsheet (default non-system sheet)
     - Reads `__LM_META/glbFileId`; if missing and **Edit mode**, prompts GLB Picker once and persists it
     - Loads GLB via `window.__LM_LOAD_GLB_BY_ID`

### How to test
1. Sign in.
2. Click **Open…** (added next to the sheet selector).
3. Pick a spreadsheet.
4. If the sheet has no `__LM_META/glbFileId` and you are in **Edit**, you will be prompted to pick a GLB once.
5. Confirm:
   - Sheet selector populates.
   - GLB loads (no Drive folder scanning behavior should occur).


## Step 01e – Fix UI placement to avoid mixing “Spreadsheet file” vs “Worksheet (gid)” concepts
**Date:** 2026-01-25

### Why
The existing **“Select sheet…”** dropdown is a *worksheet selector* (gid) inside the active spreadsheet. In Step01d we injected the dataset “Open…” button into the same row, which could be interpreted as operating on worksheets rather than the spreadsheet file itself.

### What changed
- `dataset.open.ui.js`: moved the dataset opener button into its **own dedicated row** (inserted *above* the worksheet selector row).
- Button label updated to **“Open spreadsheet…”** to make the file-level intent explicit.

### How to test
1. Reload the page (Edit/Share).
2. Confirm a new row **above** “Select sheet…” exists with **Open spreadsheet…**.
3. Click it → Picker opens → select a spreadsheet → proceeds as Step01d.


## Step 02 – Edit-mode “新規LociMyuデータ作成” panel: user-selected folder + dataset creation
**Date:** 2026-01-25

### What changed
1. **Added “New LociMyu dataset” panel to the Caption tab (Edit only)**
   - New file: `dataset.create.ui.js`
   - Injects a **collapsible** panel at the top of `#pane-caption`.
   - Hidden in Share mode.

2. **Destination folder selection is now required (Picker)**
   - Prevents accidental creation in **My Drive root**.
   - Folder selection is stored (best-effort) in localStorage for convenience.

3. **Creates the dataset spreadsheet inside the chosen folder (Drive API)**
   - Uses Drive `files.create` with `mimeType=application/vnd.google-apps.spreadsheet` and `parents=[folderId]`.

4. **Seeds required system sheets + binds GLB**
   - Ensures `__LM_META` exists and stores `glbFileId`.
   - Ensures `__LM_IMAGE_STASH` exists (hidden) and writes a minimal header row.

5. **Auto-opens the newly created dataset**
   - Dispatches `lm:sheet-context` for the created spreadsheet.
   - Loads the selected GLB via `window.__LM_LOAD_GLB_BY_ID`.

6. **Updated strategic guideline**
   - `LociMyu_Update_Requirements.md`: added “Current Implementation Status” and clarified the folder-first requirement in the Create flow.

### Why it changed
- Users must be able to choose where the dataset spreadsheet is created; placing files in My Drive root is not acceptable for low IT-literacy workflows.
- Under `drive.file`, creation and subsequent access should be scoped and user-driven (Picker-first), avoiding Drive traversal.

### How to test (manual)
1. Open the app in **Edit mode** and sign in.
2. Go to **Caption** tab.
3. Expand **New LociMyu dataset (create caption spreadsheet)**.
4. Click **Choose folder…** and select the target folder.
5. Click **Choose GLB…** and select a GLB file.
6. Optionally set the dataset name, then click **Create dataset**.
7. Confirm:
   - A new spreadsheet is created in the selected folder (not My Drive root).
   - The app automatically opens the dataset (sheet context set) and loads the GLB.


## Step 02a – Fix Picker 500 errors for Folder/GLB selection
**Date:** 2026-01-26

### Symptom
- Folder picker and GLB picker were showing a Google **500** error (docs.google.com/picker...
  Failed to load resource: the server responded with a status of 500).

### Root cause
- `dataset.create.ui.js` called `__lm_openPicker()` with string literals (`'FOLDERS'`, `'DOCS'`) instead of Picker constants.
- `picker.bridge.module.js` expected a **Picker.ViewId constant value** (e.g. `google.picker.ViewId.FOLDERS`) and created the `DocsView` with an invalid/unsupported view id, which can lead to server-side 500 errors.

### What changed
1. `dataset.create.ui.js`
   - Uses `window.google.picker.ViewId.FOLDERS` / `.DOCS` when available (falls back to strings only as a last resort).
   - Adds `includeFolders: true` on folder selection.

2. `picker.bridge.module.js`
   - Adds robust viewId resolution: accepts either a ViewId constant **or** a string key (maps `'FOLDERS'` → `ViewId.FOLDERS`, etc.).
   - For folder view (`ViewId.FOLDERS`), enables folder selection (`setSelectFolderEnabled(true)` when supported).
   - Implements `allowSharedDrives` by enabling `SUPPORT_DRIVES` / `SUPPORT_TEAM_DRIVES` features when available.

### How to test
1. Sign in.
2. In the Caption tab, open **New LociMyu dataset**.
3. Click **Choose folder…** → Picker should open without 500.
4. Click **Choose GLB…** → Picker should open without 500.

## Step 02m (2026-01-27) Open-dataset safety + SyntaxError fix

- Fixed a SyntaxError in `dataset.open.ui.js` caused by multi-line single-quoted strings (switched to template literals).
- Fixed spreadsheet URL input wiring so the value in the UI (`lmSpreadsheetUrlInput`) is actually used by the open flow.
- Removed an undefined variable reference (`urlVal`) and replaced it with an explicit `source` flag (`url` / `picker`).
- Strengthened safety checks to refuse opening spreadsheets that don’t match the expected LociMyu dataset shape, reducing the risk of accidentally reading unrelated spreadsheets.

## Step 02n (2026-01-27)

### Fixes
- Fixed a production-breaking JavaScript syntax error caused by multiline string literals in `dataset.open.ui.js` by converting user-facing `alert()` messages to single-line strings with `\n` escapes.
- Added a small version stamp log (`[dataset.open.ui] v02n loaded`) to make it easy to confirm the deployed file is updated.
- Minor cleanup: removed duplicated inline style assignments for the spreadsheet URL input (no functional change).


