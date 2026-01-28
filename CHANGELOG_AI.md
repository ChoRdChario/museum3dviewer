# LociMyu Update – AI Changelog

## Step 02p – Fix A1 quoting helper missing (unblocks caption attachment scan + access-grant picker)
**Date:** 2026-01-27

### Symptom
- URL-open succeeded and captions could bind, but Open flow aborted with:
  - `ReferenceError: a1Sheet is not defined` (from `readCaptionSheetGids()`)
- As a side-effect, the app never reached the step that aggregates GLB/image `fileId`s and opens the access-grant Picker.

### What changed
1. `dataset.open.ui.js`
   - Adds `a1Sheet(sheetTitle)` utility to always quote sheet titles for A1 notation (and escape single quotes).
   - This prevents Sheets API `Unable to parse range` errors for internal sheets and caption sheets with spaces/symbols.

### Why it changed
- The Open flow must be robust to arbitrary user sheet names; A1 ranges must be quoted safely.
- The access-grant picker workflow depends on successfully scanning caption sheets for attachment `fileId`s.

### How to test (manual)
1. Open a valid dataset by URL/ID.
   - Expected: no ReferenceError; attachment scanning runs.
2. Ensure `__LM_SHEET_NAMES` exists and contains caption sheet gids.
   - Expected: `readAttachmentFileIdsFromCaptionSheets()` returns a list (may be empty if no attachments).
3. If `drive.file` mode is on and attachment/GLB fileIds include non-public/private files:
   - Expected: the access-grant picker opens with those fileIds.

## Step 02o – Strict dataset validation for URL open (prevent accidental wrong-sheet bind)
**Date:** 2026-01-27

### Symptom
- After pasting a spreadsheet URL, a **different spreadsheet** (e.g. a Google Form response sheet) could be bound instead.
- `dataset.open.ui.js` also threw `ReferenceError: looksLikeDataset is not defined`.

### What changed
1. `dataset.open.ui.js`
   - Adds a strict dataset guard (`REQUIRED_INTERNAL_SHEETS`):
     - `__LM_META`, `__LM_SHEET_NAMES`, `__LM_MATERIALS`, `__LM_VIEWS`
   - Open flow now refuses to open any spreadsheet missing these internal sheets.
   - Removes the undefined `looksLikeDataset` usage (replaced by the guard).
   - Cleans up minor duplicated UI style lines (to avoid patch drift).

2. `LociMyu_Update_Requirements.md`
   - Updates compatibility requirements: Open is strict and must not auto-create internal sheets.

### Why it changed
- Binding to an unintended spreadsheet is a **high-severity data safety risk**.
- With URL-based open, the app must only ever use the exact spreadsheet ID derived from the input.

### How to test (manual)
1. Paste a valid dataset spreadsheet URL/ID and click **Open spreadsheet…**.
   - Expected: opens normally.
2. Paste a non-dataset spreadsheet URL (no `__LM_*` internal sheets).
   - Expected: an error dialog appears and the app does not bind/open.
3. Leave the input empty and click **Open spreadsheet…** (Picker path).
   - Expected: if you pick a non-dataset spreadsheet, it is refused.

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


## Step 02q – Drive.file grant: always show access-grant Picker (GLB required, caption attachments optional)
**Date:** 2026-01-27

### Problem
- In `drive.file`-only mode, attempting to load a GLB by fileId could still fail with Drive `alt=media` 404/403 unless the user explicitly granted access via Picker.
- The previous "public-file probe" could incorrectly skip the grant step, causing hard-to-diagnose 404s.

### What changed
1. `dataset.open.ui.js`
   - Adds an explicit **access-grant Picker** step every time a dataset is opened in `drive.file` policy.
   - The Picker is preloaded with fileIds:
     - `__LM_META.glbFileId` (required)
     - Caption attachment fileIds aggregated from caption sheets column H (best-effort)
   - Enforces that the GLB id must be picked; caption attachments may be picked partially.
   - Removes the "public-file probe" skip logic to avoid false positives and silent data access failures.
   - Keeps a retry path: if GLB load still fails, re-open a single-file grant Picker for the GLB and retry once.

2. `LociMyu_Update_Requirements.md`
   - Bumped document version to v1.5.
   - Updated the Step02 Edit open flow to reflect "URL is the source of truth" and the new access-grant Picker behavior.

### How to test (manual)
1. Enable `__LM_POLICY_DRIVEFILE_ONLY` (or run the build configured for drive.file-only).
2. Paste a known dataset spreadsheet URL and click **Open spreadsheet**.
3. Confirm:
   - The access-grant Picker opens and lists the GLB (and any caption attachments found).
   - After selecting the GLB (at minimum), the GLB loads.
   - Caption still opens normally even if no attachments are selected.


## Step 02r – Shared Drive + resourceKey compatibility for drive.file grant & Drive fetch
**Date:** 2026-01-27

### Problem
- Grant Picker could show **"No documents"** when we try to pre-navigate by fileIds while also enabling Shared Drives browsing.
- GLB downloads from Shared Drives could fail with Drive `alt=media` **404** (missing `supportsAllDrives=true`).
- Link-shared items protected by a **resourceKey** could not be fetched via Drive API without providing the resourceKey.

### What changed
1. `picker.bridge.js`
   - Fix: avoid calling `DocsView.setEnableDrives(true)` when `setFileIds(...)` is used (Picker docs state they override each other).
   - Still enables the `SUPPORT_DRIVES` feature on the Picker builder for Shared Drive compatibility.

2. `viewer.module.cdn.js`
   - Fix: add `supportsAllDrives=true` to Drive `alt=media` requests.
   - Add: send `X-Goog-Drive-Resource-Keys: <fileId>/<resourceKey>` header when a resourceKey is known.

3. `dataset.open.ui.js`
   - Add: accept Drive URLs (not just raw ids) in dataset fields and extract `resourcekey=...` when present.
   - Add: cache resource keys into `window.__lm_driveResourceKeys` and opportunistically record `doc.resourceKey` returned by Picker.

4. `caption.images.loader.js`
   - Fix: `await getAuthFetch()` (was a Promise, not a fetch function).
   - Add: include resourceKey header when fetching Drive metadata.

5. `glb.btn.bridge.v3.js` and `boot.esm.cdn.js`
   - Add: parse and cache `resourcekey=...` from user-provided Drive URLs.
   - Fix: add `supportsAllDrives=true` for Drive downloads.

### How to test (manual)
1. Create or use a dataset where the GLB lives in a **Shared Drive**.
2. Open the dataset URL in drive.file-only mode.
3. Confirm:
   - The access-grant Picker shows the GLB (not "No documents").
   - After selecting, the GLB downloads and loads (no Drive 404).
4. (Optional) Put a full Drive URL containing `resourcekey=...` into `__LM_META.glbFileId` or a caption sheet H cell.
   - Confirm Drive fetch succeeds after granting access.


## Step 02s – Asset folder-rooted Picker (fix "No documents" for binary assets)
**Date:** 2026-01-27

### Problem
- In some datasets, the access-grant Picker showed **"No documents"** when preloading by `fileId` (notably for non-Google binary assets such as `.glb`).
- The old "GLB URL" input had become a dead UI element after sheet-first dataset opening.

### What changed
1. `index.html`
   - Repurpose the top input into **Asset folder URL**.
   - Repurpose the button into an **Open folder** action.

2. `glb.btn.bridge.v3.js`
   - The top button now opens the entered folder URL in a new tab and stores it to `localStorage` (`lmAssetFolderUrl`) so the dataset open flow can reuse it.

3. `dataset.open.ui.js`
   - When an Asset folder is available, open the access-grant Picker **rooted at that folder** (`parentId`) and apply a permissive `mimeTypes` filter (GLB + common images + `application/octet-stream`).

4. `picker.bridge.js`
   - Add support for `parentId` and allow `mimeTypes` to be specified as either array or comma-separated string.
   - Do not force `includeFolders/selectFolderEnabled` just because Shared Drives are enabled.

### How to test (manual)
1. In drive.file-only mode, paste the **asset folder** URL (Drive folder link) into the top field and click **Open**.
   - If needed, add the folder as a shortcut to **My Drive** in the opened tab.
2. Paste the dataset spreadsheet URL and click **Open spreadsheet**.
3. Confirm:
   - The access-grant Picker opens inside the asset folder (not empty).
   - Selecting the required GLB (and any images) allows the dataset to load.

- 2026-01-28: v1.4.5 patch: Resolve shortcut folder IDs in Stage B and fallback when setFileIds view is empty.
