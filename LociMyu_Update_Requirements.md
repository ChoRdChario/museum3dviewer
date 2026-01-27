# LociMyu Update Requirements (Drive scope → drive.file / Picker migration)

**Version:** 1.4  
**Last Updated:** 2026-01-28  

This document is the source of truth for the ongoing migration from restricted Drive scopes to **drive.file** and the associated **Google Picker** based access model.

---

## 1. Goal

- Remove restricted Drive scopes (e.g., `drive.readonly`) and migrate to **`drive.file`**.
- Keep the app usable for **unspecified / public users** (不特定多数) without requiring paid third‑party security review for restricted scopes.
- Avoid data leaks (e.g., opening the wrong spreadsheet) and keep user intent explicit.

---

## 2. Current Problem Summary

### 2.1 Symptoms

- **Picker shows “No documents”** when trying to open assets in a shared folder.
- **Drive API `files.get` returns 404** for a folder that the user can see in the Drive UI (even if it is added as a shortcut in My Drive).
- Even when spreadsheet captions can be read, asset access grant via Picker fails (GLB not selected / not visible).

### 2.2 Root Cause (drive.file behavior)

Under **drive.file**, the app can only access:
- files created by the app, or
- files the user **explicitly selected via Picker** while using the app.

Therefore, “ユーザーのDrive UIで見えている” ≠ “アプリ(API)で見える”.  
A shortcut in My Drive does **not** automatically make the underlying folder/file accessible via the API → it may appear as **404**.

### 2.3 Strategy Change (two-stage authorization)

To make shared assets usable under **drive.file**, we adopt a **two-stage Picker authorization flow**:

1) **Asset Folder Picker (folder itself)**  
2) **Access Grant Picker (files inside the folder, bulk selection)**

This is now the canonical approach.

---

## 3. Principles

### P1. Spreadsheet URL is the dataset anchor
The dataset is anchored by a spreadsheet URL typed/pasted by the user.  
We do not “guess” or auto-switch to another spreadsheet.

### P2. No hidden scanning / no broad traversal
The app must not search the user's Drive broadly.

✅ Allowed:
- **List direct children only** inside the **explicitly user-selected asset folder**, for the sole purpose of building a candidate list to show in the grant Picker.
- No recursion by default (no deep traversal), no searching outside that folder.

❌ Not allowed:
- Searching arbitrary folders, “Shared with me”, or entire Drive.
- Traversing parent/sibling directories beyond the chosen asset folder.

### P3. User-confirmed access for each file
Under drive.file, file access must be obtained via **Picker selection**.  
Selecting a folder alone may allow listing, but does not reliably grant read access to all contained files.

---

## 4. Definitions

### 4.1 Dataset Spreadsheet (セーブデータ)
A spreadsheet that contains the required LociMyu system sheets:

- `__LM_META`
- `__LM_SHEET_NAMES`
- `__LM_MATERIALS`
- `__LM_VIEWS`

If any are missing → treat as “not a dataset” and show a clear error.  
**Do not auto-create missing sheets.**

### 4.2 Asset Folder (アセットフォルダ)
A Drive folder containing all assets used by the dataset (assume assets are directly under the folder root):

- GLB files (`model/gltf-binary`)
- Image files (`image/*` etc.)

---

## 5. Implementation Status (as of v02q / v02… series)

- Spreadsheet read path is partially working (caption sheet selection, etc.).
- Asset folder ID is being set (log shows `{folderId: ...}`), and file IDs can be collected (images count increases).
- However, the grant Picker still ends with **“No documents”** or fails selection verification (GLB not selected), meaning the current Picker build/feature flags/view configuration and/or the authorization sequence is incomplete.

---

## 6. Required UX (Minimum Viable)

We prioritize “works reliably” over refined UX for now.

### 6.1 Inputs / Controls
- Replace the old “GLB URL input” with **Asset Folder URL input**.
- Keep Spreadsheet URL input (dataset anchor).

### 6.2 Two-stage flow (required)

#### Stage A: Prepare the Asset Folder (user-side)
Because a shared folder may not be visible to the app/API under drive.file:

1. User pastes an **asset folder URL**.
2. App opens that URL in a **new tab** and instructs the user to **add the folder to My Drive** (ショートカット追加 / “マイドライブに追加”).
3. User returns to the app.

#### Stage B: Asset Folder Picker (folder selection)
4. User clicks **“Select Asset Folder”**.
5. Picker opens in a mode that allows selecting folders.
6. User selects the folder → app stores `assetFolderId`.

#### Stage C: Access Grant Picker (bulk file selection)
7. App lists the direct children of `assetFolderId` via Drive API (files.list) with:
   - `supportsAllDrives=true`
   - `includeItemsFromAllDrives=true` (if used)
   - query: `'<folderId>' in parents and trashed=false`
8. Filter to target mime types (GLB + images).
9. Build a fileId list and open a **grant Picker**:
   - multiselect enabled
   - seeded with candidate files (by fileIds and/or constrained view)
10. User selects all required files and confirms.
11. App verifies at least the required GLB is selected; if not, show explicit error telling user to select it.
12. App proceeds to load and run.

> Note: If we already know “required fileIds” from the dataset sheet (GLB + caption image IDs), we still do Stage B first (folder) to avoid 404/no-documents; then Stage C can focus on those required IDs (plus optional folder scan).

---

## 7. Data Model Rules

### 7.1 __LM_META
Minimum required keys:

- `glbFileId` (string)
- `assetFolderId` (string) **(NEW / recommended)**

Storing `assetFolderId` in `__LM_META` is recommended so the dataset is portable between machines/users.  
If this is not implemented yet, localStorage fallback is acceptable.

### 7.2 Caption image references
- Caption sheets keep image file IDs in **column H** (per earlier design).
- We do **not** aggregate image IDs into `__LM_META` (Decision “A”).

---

## 8. Validation & Error Handling

### 8.1 Dataset validation
- Validate by presence of required system sheets (names above).
- Do not validate by gid.
- Do not create missing sheets.

### 8.2 Asset folder validation
- If `files.get(assetFolderId)` returns 404 under drive.file, treat it as “not authorized yet” and guide user to:
  - open folder URL in a new tab
  - add shortcut to My Drive
  - run Stage B folder Picker again

### 8.3 Grant Picker validation
- If Picker returns no documents / empty:
  - likely the folder was not picked first, or Picker view/features are misconfigured
  - treat as authorization failure and instruct user to re-run Stage B (folder Picker)
- If required GLB fileId is not among selected docs → stop and show a clear error.

---

## 9. API / Scope Rules

- OAuth scopes must be limited to drive.file (and any non-restricted scopes already used).
- Drive API calls must be limited to:
  - reading/writing the dataset spreadsheet (Sheets API)
  - listing direct children under the selected asset folder (Drive API)
  - reading assets (Drive `alt=media`) only after user grant via Picker

---

## 10. Security Notes

### 10.1 Data leak prevention
- Never “fall back” to some other spreadsheet ID.
- Spreadsheet is only what the user specified.

### 10.2 Traversal definition (updated)
- “Traversal” includes any attempt to discover files beyond what the user explicitly indicated.
- **Exception:** listing direct children of the user-selected asset folder is allowed as a bounded, user-intended operation.

---

## 11. Open Items / TODO

1. Finalize Picker configuration for:
   - folder selection (Stage B)
   - bulk grant (Stage C)
2. Decide persistence of `assetFolderId`:
   - preferred: `__LM_META`
   - fallback: localStorage
3. Decide whether Stage C should:
   - show all assets in folder (simpler), or
   - show only required fileIds derived from spreadsheet (stricter)

---

## 12. Acceptance Criteria

A. With only **drive.file**, a user can:
- prepare a shared asset folder (add shortcut to My Drive),
- select the folder via Picker,
- bulk-grant GLB + images via Picker,
- open a dataset spreadsheet and run the viewer.

B. App never opens a spreadsheet other than the one the user specified.

C. App does not auto-create missing dataset sheets; it fails fast with a clear error.

