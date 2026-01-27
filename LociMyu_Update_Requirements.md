# LociMyu Update Requirements (Strategic Guideline)

## Current Implementation Status

- **Step01 (completed):** drive.file policy flagging + Google Picker foundation + “Open spreadsheet…” UI for spreadsheet-first operation.
- **Step02 (in progress / implemented in code):** Edit-mode “新規LociMyuデータ作成” panel now requires an explicit **destination folder selection** (Picker) and creates the dataset spreadsheet **inside that folder** (not My Drive root). The spreadsheet is seeded with the dataset-required internal sheets: `__LM_META`, `__LM_SHEET_NAMES`, `__LM_MATERIALS` (legacy header), `__LM_VIEWS`.
- **Step02a (completed):** Fixed Google Picker **500 error** during folder/GLB selection by normalizing Picker viewId usage (`google.picker.ViewId.*`) and hardening the Picker bridge’s viewId resolution.
- **Step02b (completed):** Fixed Picker selection handling so callers only receive results on **user intent** (`picked` / `cancel`). The bridge no longer resolves early on the initial `loaded` event, and folder picking explicitly enables folder selection (`includeFolders` + `selectFolderEnabled`).
- **Step02e (completed):** New dataset creation now always creates `__LM_MATERIALS` with the legacy canonical header (`A1:N1`) to keep material save data migration straightforward.
- **Next planned:** drive.file access-grant Picker for GLB + caption attachments (caption sheets column H), and Share-mode sheet-first flow.
**Version:** 1.5  
**Date:** 2026-01-27 (Asia/Tokyo)  
**Purpose:** This document is the single source of truth for the LociMyu update. It is written to keep development aligned with Google OAuth verification requirements and the agreed UX/architecture decisions. During implementation, when tradeoffs arise, prefer decisions that preserve the principles and invariants in this document.

---

## 1. Background and Goal

Google’s verification feedback strongly recommends avoiding restricted Drive scopes and using narrower scopes (notably `drive.file`) wherever possible. The current implementation relies on Drive folder traversal/search (restricted scope direction). This update re-architects LociMyu so that:

- **Drive access is limited to user-selected files (Picker-based)**
- **The application is sheet-centric** (the spreadsheet is the source of truth / entry point)
- **Drive listing/search traversal is removed**
- **Share mode is safe and predictable**, and does not expose unintended content in the app UI

This is a strategic shift; the implementation must remain consistent with these constraints.

---

## 2. Scope and Definitions

### 2.1 Modes
- **Edit mode:** Full authoring workflow (create/load data, edit captions, manage images, rename spreadsheet file).
- **Share mode:** Read-only view. Shows only images attached to captions. No new data creation UI.

### 2.2 IDs
- **Drive fileId:** The identifier for a Drive file (GLB, image, spreadsheet). (User sometimes wrote “fieldid”; treat it as fileId.)

- **Drive resourceKey:** Some link-shared Drive items require a **resourceKey** to be accessed via the Drive API (Drive “security update”).
  - In this update, resourceKeys are **captured opportunistically from Picker selections** (or pasted Drive URLs) and stored in **runtime memory**.
  - When fetching `files.get?alt=media`, attach `X-Goog-Drive-Resource-Keys: <fileId>/<resourceKey>` when available.
  - This does **not** change the minimum-scope policy: it still works under `drive.file` as long as the user explicitly selects the file in Picker.

### 2.3 Sheets
- **Caption spreadsheet (LociMyu data):** A Google Sheets file that contains caption sheets and internal `__LM_*` sheets used by the app.
- **Caption sheets:** User-facing sheets with caption headers used for rendering/editing.
- **Internal sheets:** Sheets prefixed with `__LM_` used to store metadata and app-managed data.

---

## 3. Principles and Invariants (Do Not Break)

### P1. Minimum Drive permissions
- **Do not request restricted Drive scopes** (e.g., `drive.readonly`).
- Use **`drive.file`** for Drive.
- Use the minimum necessary Sheets scope (`spreadsheets` for edit, `spreadsheets.readonly` for share).

### P2. No Drive traversal/search
- **No folder walking, no `files.list`-based discovery** of “related files”, and no “same-folder auto enumeration”.

### P3. Sheet-first architecture (entrypoint)
- **Both Edit and Share start from a spreadsheet selection** (or spreadsheet fileId/URL that is finalized via Picker).
- GLB is determined **from spreadsheet metadata**, not by scanning folders.

### P4. Share UI limitation
- Share mode **displays only images attached to captions** (caption-referenced images).
- **Candidate (unused) images are not displayed in Share UI.**

### P5. “Not shown in app” ≠ “not accessible in Drive”
- The app must communicate that **Drive file visibility depends on Drive sharing settings**. If an image file is shared in Drive, it may be viewable outside the app.

### P6. Legacy UI preservation for images
- Image gallery layout and look/feel remain the same.
- Only the *data source* changes: from “auto enumerated folder listing” to “sheet-derived lists”.

### P7. Refresh semantics
- The existing “更新 / Refresh” button is redefined as:
  - **Re-read the saved lists from Sheets and re-render** (not Drive listing).

---

## 4. High-Level Architecture (Target)

### 4.1 Data sources by mode
**Edit mode**
- Spreadsheet is selected/authorized first.
- GLB is read from `__LM_META`.
- Images displayed:
  - **Caption-attached images** aggregated from caption sheets (column **H = fieldId/fileId**)
  - (Optional future) a curated candidate list sheet, if we later re-introduce it.

**Share mode**
- Spreadsheet is selected/authorized first.
- GLB is read from `__LM_META`.
- Images displayed:
  - **Caption-attached images only** (aggregate from caption sheets, column **H**)
- Candidate images never shown in Share UI.

### 4.2 Picker usage
Picker is the standard mechanism to “explicitly select” files under `drive.file`:
- Spreadsheet selection (entrypoint)
- Additional selection for GLB and images when access is missing or to add candidate images

**Shared Drives / shared-with-me:** The Picker bridge must enable shared drive visibility (`SUPPORT_DRIVES` + view drives enabled) so that link-shared or Shared Drive files can actually be selected (avoid “No documents”).

---

## 5. Required Scopes (Target)

### 5.1 Edit mode
- Drive: `https://www.googleapis.com/auth/drive.file`
- Sheets: `https://www.googleapis.com/auth/spreadsheets` (or narrower if proven sufficient)

### 5.2 Share mode
- Drive: `https://www.googleapis.com/auth/drive.file`
- Sheets: `https://www.googleapis.com/auth/spreadsheets.readonly`

**Important:** Keep Cloud Console OAuth consent screen scopes, verification submission scopes, and code-defined scopes consistent.

---

## 6. Spreadsheet Structure (Target Spec)

### 6.1 Internal sheet: `__LM_META`
- **Purpose:** Minimal metadata necessary to load the dataset.
- **Content:** ONLY `glbFileId` at this time.
- **Recommended schema:** key/value
  - Row 1: `key`, `value`
  - Row 2: `glbFileId`, `<drive-file-id>`

### 6.2 Internal sheet: `__LM_IMAGE_STASH` (Optional future)
- **Status:** optional / deferred. Current Step02 focuses on **caption-attached images** (caption sheets column H) and does not require a separate curated stash.
- If we re-introduce a curated candidate list later, `__LM_IMAGE_STASH` can be used as a minimal fileId list.

### 6.3 Caption sheets
- Existing caption sheet headers remain the standard and define “caption-attached images”.
- The application must be able to scan caption sheets to collect all image fileIds referenced by captions.

### 6.4 Other existing `__LM_*` sheets
- Existing internal sheets may remain (e.g., views), but must not break P1–P4.
- For **newly created datasets**, the app must ensure `__LM_MATERIALS` exists with the legacy-compatible header schema (A1:N1). This prevents material-load failures and makes save-data migration straightforward.
- Share-side sheet selection logic that excludes `__LM_` sheets remains valid and should continue.

---

## 7. User Flows (Target)

### 7.1 Edit — Create new dataset (in Caption tab, collapsed UI)
1. User signs in (Edit scopes).
2. In Caption tab, user expands **“新規LociMyuデータ作成”** panel.
3. User selects **destination folder** via Picker (required; must not default to My Drive root).
4. User selects GLB via Picker.
5. App creates a new spreadsheet (LociMyu dataset) **inside the chosen folder**.
6. App creates `__LM_META` and stores `glbFileId`.
7. App creates `__LM_IMAGE_STASH`.
8. App creates `__LM_MATERIALS` (legacy schema) for material settings.
9. App transitions to “opened dataset” state (dispatch `lm:sheet-context`).

### 7.2 Edit — Open existing dataset (sheet-first)
1. User signs in.
2. User provides Spreadsheet URL/ID and clicks “Open spreadsheet”.
   - If the input is empty, Picker may be used for selection.
   - **Safety rule (2026-01-27):** If the user provided a URL/ID, treat that ID as authoritative and **do not fall back** to Picker on parse/validation failure (avoid opening the wrong sheet and causing an information incident).
   - Validate the dataset by checking that required `__LM_*` sheets exist (must not auto-create them during Open).
3. App reads `__LM_META.glbFileId`.
4. App reads caption sheets and loads caption data; it also collects **caption-attached** Drive `fileId`s from caption sheets column **H** (best-effort).
5. In `drive.file` policy, app prompts a **single “access-grant” Picker** for:
   - GLB `fileId` (required)
   - Caption-attached `fileId`s (optional; but should be offered upfront so the user can grant in one step)
6. App loads GLB and proceeds with the opened dataset.
7. Image UI is refreshed using the collected caption-attached `fileId`s.

### 7.3 Edit — Add candidate images (Picker)
- User uses “Add images” action in the same image UI area.
- Selected fileIds are appended/deduped into `__LM_IMAGE_STASH`.
- UI refreshes without changing layout.

### 7.4 Share — Open dataset (sheet-first, no creation UI)
1. User signs in (Share scopes).
2. User selects dataset spreadsheet (Picker; link may prefill `spreadsheetId`).
3. App reads `__LM_META.glbFileId` and loads GLB (if permitted; otherwise prompt Picker).
4. App reads caption sheets and renders.
5. Images displayed are **caption-attached only**.
6. Refresh button triggers re-read from Sheets and re-render.

---

## 8. UI Requirements (Target)

### 8.1 Caption tab layout (Edit)
Order from top to bottom:
1. **(Collapsed by default) 新規LociMyuデータ作成**
   - Contains: destination folder selection (Picker), GLB selection (Picker), dataset name input (optional), Create action.
   - Must not auto-create datasets in My Drive root; folder must be user-selected.
2. **Current spreadsheet file name + rename UI** (Drive file rename)
3. **Caption sheet selector**
4. **Image gallery area** (same placement and visual style as legacy)
5. **Always-visible sharing caution** (text only; exact wording TBD during implementation)

**Share mode:** The “新規LociMyuデータ作成” panel is hidden.

### 8.2 Spreadsheet file rename (Drive file name)
- Shown in Edit mode; Share should be display-only (or hidden).
- Must rename the **Drive file name** of the spreadsheet, not internal sheet tab names.
- Avoid conflicts with existing internal “sheet rename” module; treat as separate responsibility.

### 8.3 Sharing caution
- Must communicate:
  - Share mode shows only caption-attached images in-app
  - Drive sharing settings determine whether files are viewable outside the app
- Exact text to be decided during implementation.

### 8.4 Refresh button behavior
- **Refresh = re-read saved lists from Sheets and re-render**
- In Share, this enables a viewer to see updates after an editor changes captions/images.

---

## 9. Compatibility and Migration

### 9.1 Legacy / Non-initialized spreadsheets
In this phase, **Open** is intentionally strict for safety and predictability.

- A spreadsheet is treated as a LociMyu dataset only if it contains all required internal sheets:
  - `__LM_META`
  - `__LM_SHEET_NAMES`
  - `__LM_MATERIALS`
  - `__LM_VIEWS`
- If any are missing, the app must **refuse to open** the spreadsheet and show an error.
- The Open flow must **not auto-create** internal sheets on the user’s behalf.

### 9.2 Legacy “same folder auto enumeration”
- Must be removed.
- Replace with sheet-derived lists (caption-attached + candidate stash).

---

## 10. Security and Safety Requirements

### 10.1 Share-mode write prevention
- Keep the existing Share-side fetch guard concept:
  - Block non-GET requests to Drive/Sheets in Share mode.

### 10.2 No hidden “scan” behavior
- Do not silently enumerate folders or attempt to discover files beyond user selection and sheet-listed fileIds.

---

## 11. Implementation Constraints (Derived from current codebase review)

### 11.1 Known replace/remove targets (current code uses traversal)
- `save.locator.js` (GLB-folder discovery + create)
- `save.locator.share.js` (GLB-folder discovery)
- `share.sheet.read.js` (GLB-first flow)
- `drive.images.list.js` (folder enumeration)
- `caption.images.loader.js` (depends on folder enumeration)
- Share link generation and parsing: `edit.sharelink.ui.js`, `glb.url.prefill.js`

### 11.2 Existing assets to reuse
- `lm:sheet-context` event-based architecture for caption/material loading
- Image UI ingestion via `__LM_CAPTION_UI.setImages(...)`
- HEIC/HEIF acceptance logic currently implemented in legacy image listing code (must be preserved in new list builder)

### 11.3 Picker implementation status (implemented)
- Implemented Picker bootstrap + API key wiring + callback plumbing.
- Implemented spreadsheet picker (open existing dataset) and GLB/folder pickers (create dataset flow).
- **Guardrail:** normalize Picker callback `action` to lowercase (`picked`/`cancel`) because some environments may emit uppercase variants; consumers must treat action case-insensitively.

---

## 12. Acceptance Criteria (Definition of Done)

### 12.1 Verification alignment
- App requests only the intended scopes (no `drive.readonly`).
- Console consent screen, verification submission, and code scopes match.

### 12.2 Functional correctness
- Edit and Share both open datasets from spreadsheet entry.
- GLB loads from `__LM_META.glbFileId` after selection/authorization.
- Share displays only caption-attached images in-app.
- Refresh re-reads from Sheets and reflects updates.

### 12.3 UX consistency
- Image gallery appears in the same location and same visual style as before.
- HEIC/HEIF behavior matches legacy expectations.

### 12.4 Data correctness
- `__LM_META` exists for all active datasets after migration.
- `__LM_IMAGE_STASH` exists and is editable (add/remove/dedupe).

---

## 13. Open Items (Deferred to implementation-time discussion)
- Exact wording of sharing cautions and messages
- Exact column schemas beyond minimal (`fileId` only) for `__LM_IMAGE_STASH`
- Share mode UI treatment for spreadsheet rename (display-only vs hidden)
- Detailed error message taxonomy and retry UX for missing permissions

---

## Appendix A. Glossary
- **SOT:** Source of Truth (here: the spreadsheet)
- **Picker:** Google Picker API selection UI
- **Traversal:** Drive folder enumeration/search for related files (forbidden by P2)

---

## 14. Development Process Rules (AI/Implementation Guardrails)

These rules exist to prevent drift from this document and to keep submissions reviewable.

### R1. Always read this document before changes
- Before any implementation work, read the latest `LociMyu_Update_Requirements.md` and keep it open.
- When uncertain, prefer aligning code behavior with the Principles and Invariants (Section 3).

### R2. Update the requirements when decisions change
- If a new decision, constraint, or agreed UX rule is introduced during development, append it to this document.
- Keep changes additive (do not silently rewrite prior decisions); bump the Version and record the intent.

### R3. Validate before submitting
- Perform basic syntax checks for modified JS files (at minimum Node `--check` where applicable).
- Run any existing build/test steps available in the repo (if present) and resolve errors before submission.
- Ensure Share-mode safety: no write-capable modules should be loaded in Share mode.

### R4. Submission packaging
- Submit updates as a zip that contains only the changed files (plus `CHANGELOG_AI.md`).
- Include a `CHANGELOG_AI.md` describing what changed, why, and how to test.

### R5. No scope regression
- Never re-introduce restricted Drive scopes (e.g., `drive.readonly`).
- Ensure Console consent scopes and code scopes remain consistent.
