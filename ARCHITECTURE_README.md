# LociMyu Web Tool — Code Map & Wiring Guide

This document catalogs the current codebase (as provided in `index.zip`) and
explains **what each file does**, **what it exports**, **what DOM it expects**, and
**how modules are intended to work together**. It’s meant to be a hands-on wiring
guide for implementing Google auth → GLB load → captions flow.

> Scope of this doc is the current bundle you shared (UI-first, with Drive/Auth stubs).

---

## High-level flow (target)

1) **Sign in with Google** → obtain Drive access token.
2) **GLB load** (by Drive file id/URL or demo) → initialize viewer.
3) **Caption data load** (pins) → render pin list (and optional image thumbs).
4) **Edit captions** → write back to storage (now local/in-memory; later Drive/Sheets).
5) **Filter / Pin color** → update which pins are visible and the active color.
6) **Refresh images** → fetch images colocated with model file (Drive folder).

Today, steps 1 & 6 are **stubbed**; viewer and pin list are local/in‑memory.

---

## File-by-file

### `index.html`
- Declares the whole UI and anchors for JS to hook into.
- **Key DOM ids / classes used by JS**
  - Tabs: `#tab-caption`, `#tab-material`, `#tab-view`
  - Auth: `#authSignBtn` (text toggled by `gauth.module.js`), `#authStatusBadge`
  - GLB input section:
    - `#inputDrive` (text input for Drive id/URL)
    - `#btnLoadDemo` (“GLB” / demo loading button)
    - `#saveTarget` (select – currently “Pins” only)
    - `#btnTargetAdd` (“+” to add save stores, reserved)
  - Pin options:
    - Color swatches: buttons with `data-color` under `#pinColors`
    - Filter: `#filterSelect`
  - Caption list and editor:
    - `#captionList` (textarea – list view placeholder)
    - `#titleInput`, `#bodyInput`
    - `#btnAddPin`, `#btnClear`, `#btnRefreshImages`
  - Viewer host:
    - `#viewerRoot` (canvas parent; `viewer.ensureViewer()` attaches here)

### `app.css` / `leader.css`
- **App theme** (dark) and layout (right-side panel).
- `.toolbar`, `.btn`, `.chip`, `.select`, `.swatch` styles used by the panel.
- `leader.css` is a small design add-on (sizes/spacing).

### `app_boot.js`
- **Entry point** orchestrating boot:
  - Imports and calls: `setupAuth()`, `setupPins()`, `ensureViewer()`.
  - Wires tab buttons.
  - Logs boot stages for troubleshooting.
- **No exports** – runs on load.

### `gauth.module.js`
- **Auth stub** (for now). Real Google auth is to be swapped in.
- Exports:
  - `setupAuth({signBtnId, statusBadgeId, onAuthChange})`
    - Binds click to the sign-in button, toggles an internal boolean, and calls `onAuthChange(isSignedIn)`.
    - Updates status chip/badge text.
  - `getAccessToken()` → returns `null` (stub).
  - `isSignedIn()` → boolean of local state.
- **DOM dependencies**: the ids passed from `app_boot.js` must exist (`authSignBtn`, `authStatusBadge`).

### `gauth.js`
- **Thin adapter** (legacy hook) for the auth system. Currently not used elsewhere.
- Exports: `signIn()`, `signOut()`, `getToken()` – all stubs logging to console.
- Keep until migration is complete or remove after full wiring of `gauth.module.js`.

### `utils_drive_api.js`
- **Drive helper (stub)**.
- Exports: `resolveFileIdOrUrl(v)` → returns trimmed value.
- In a real impl, parse Drive share URLs, extract file id, and normalize.

### `utils_drive_images.js`
- **Image download helper (stub)**.
- Exports: `downloadImageAsBlob(driveFileIdOrUrl)` → returns a 1x1 transparent PNG `Blob`.
- Replace with authenticated Drive `files.get(media=true)` when auth is live.

### `viewer.js`
- **Three.js viewer host** (no actual Three.js import yet; UI-first).
- Exports:
  - `ensureViewer(rootId = 'viewerRoot')` → attaches a placeholder canvas/text and sets ready state.
  - `setPinColor(hex)` → stores active color, logs `"[viewer] color set …"`.
  - `addPinAtCenter({title, body, color})` → mock: appends a line to the textarea list and logs.
  - `clearPins()` → clears the displayed list.
- Internals:
  - Keeps `state = { root, ready, activeColor }`.
  - In real impl, instantiate `THREE.WebGLRenderer`, camera, controls, etc., and pin sprites.

### `viewer_addons.js`
- **Placeholder** for future viewer utilities. Currently unused.

### `pins.js`
- **Panel controller** for the “Caption” tab. Wires UI → viewer and data.
- Exports: `setupPins()`
  - Registers event handlers:
    - Color swatches → `viewer.setPinColor()`
    - `#btnAddPin` → collects `#titleInput/#bodyInput` and calls `viewer.addPinAtCenter()`
    - `#btnClear` → `viewer.clearPins()`
    - `#btnRefreshImages` → iterates images (now stubbed)
    - `#filterSelect` → log only (stub – filter logic to be added)
    - `#btnLoadDemo` → simulates a GLB load request (“demo”) and calls `ensureViewer()`
  - Maintains small in-memory pin list (array) to mirror viewer calls.
  - Emits console logs with `[pins]` prefix for debugging.

### `ui.js`
- **Small helpers for tabs and element lookup**.
- Exports:
  - `qs(id)` → `document.getElementById(id)`
  - `switchTab(tabName)` → shows one of `caption/material/view` panels.
- Used by `app_boot.js` and `pins.js`.

### `material.js` / `material_panel.js`
- **Material tab stubs** (no active wiring in current revision).
- Keep as placeholders; once viewer has meshes/materials, these will expose controls.

### `sheets_api.js`
- **(Future)** Integration with Google Sheets (CRUD of captions). Currently unused.

---

## Wiring diagram (current)

```
index.html
  ├─ app_boot.js  (boot)
  │    ├─ gauth.module.js        (setupAuth → auth state callbacks)
  │    ├─ pins.js                (setupPins → UI handlers)
  │    ├─ viewer.js              (ensureViewer → host canvas / mock pin ops)
  │    └─ ui.js                  (tab switching)
  ├─ app.css / leader.css        (styles)
  └─ other modules (stubs): gauth.js, utils_drive_api.js, utils_drive_images.js,
                           material.js, material_panel.js, sheets_api.js
```

---

## What must exist in the DOM (checklist)

- `#viewerRoot` → viewer attaches here (left side).
- Auth
  - `#authSignBtn` (button) – required by `setupAuth`
  - `#authStatusBadge` (span/div chip) – updated by `setupAuth`
- Caption tab (ids are referenced in `pins.js`):
  - `#inputDrive`, `#btnLoadDemo`, `#saveTarget`, `#btnTargetAdd`
  - `#pinColors` container with children having `data-color="#rrggbb"`
  - `#filterSelect`
  - `#captionList` (textarea)
  - `#titleInput`, `#bodyInput`, `#btnAddPin`, `#btnClear`, `#btnRefreshImages`

---

## Where real logic will plug in

### 1) Google Auth
- Replace `gauth.module.js` internals with **Google Identity Services** OAuth2 flow.
- On success:
  - Store access token in module scope
  - Call `onAuthChange(true)` from `setupAuth()`
- Expose:
  - `getAccessToken()` (string)
  - `isSignedIn()`

### 2) Drive ID resolution & GLB loading
- `utils_drive_api.resolveFileIdOrUrl()`:
  - Parse share URLs like `https://drive.google.com/file/d/<ID>/view?...` → `<ID>`.
- Viewer:
  - Add `loadGLB(fileIdOrUrl, {token})` to `viewer.js`.
  - Use `THREE.GLTFLoader` with `setRequestHeader({ Authorization: 'Bearer …' })` for Drive download URL.
- `pins.js`:
  - On `#btnLoadDemo` or a new **Load** button → call `viewer.loadGLB()` with resolved id.

### 3) Caption persistence
- Options:
  - **Drive JSON** colocated with GLB (`<basename>.pins.json`), or
  - **Google Sheets** via `sheets_api.js` (sheet: id, title, body, color, order, timestamps).
- Implement in `pins.js`:
  - `loadPinsFor(modelId)`, `savePinsFor(modelId, pins[])`.
  - Bind autosave on `+ Pin` and `Clear`.

### 4) Image thumbnails colocated with GLB
- `utils_drive_images.downloadImageAsBlob()`:
  - Given the GLB file id, query its **parent folder** on Drive, list `*.jpg|*.png`.
  - Cache thumbnails (Blob URLs) to show in the caption list.

### 5) Filters & colors
- Implement filter predicate in `pins.js` (e.g., `(All)`, or by color).
- Update viewer pin visibility (store per-pin color / group).

---

## Test plan order (what you asked for)

1. **Auth**: Implement real Google auth in `gauth.module.js` and verify `isSignedIn() === true` and `getAccessToken()` returns a token.
2. **GLB load**: Add `viewer.loadGLB(fileIdOrUrl, token)`; wire to the “GLB” load button.
3. **Caption load**: Decide source (Drive JSON or Sheets) and wire `loadPinsFor()` immediately after successful GLB load.
4. **Caption edit/save**: Hook `+ Pin`, `Clear` to persistence functions.
5. **Images**: Replace `downloadImageAsBlob()` and fetch colocated images.
6. **Filter/UX polish**: Implement filter logic and active color indications.

---

## Known gaps & TODOs (from current code)

- Real Three.js viewer (renderer, orbit controls, model loading).
- Real Google OAuth2 and Drive file access.
- GLB parser and scene pinning math (raycast → world point, screen-to-world).
- Persistence backend selection (Drive JSON vs. Sheets) and schema.
- Material & View tabs: connect to actual scene/state.
- Error states and toast notifications.
- Favicon 404 (either add `/favicon.ico` or remove `<link rel="icon">`).

---

## Quick “contract” of main modules (for future wiring)

```ts
// gauth.module.js
export function setupAuth(opts: {
  signBtnId: string;
  statusBadgeId: string;
  onAuthChange: (signedIn: boolean) => void;
}): void;
export function isSignedIn(): boolean;
export function getAccessToken(): string | null;

// viewer.js
export async function ensureViewer(rootId?: string): Promise<void>;
export function setPinColor(hex: string): void;
export function addPinAtCenter(pin: {title: string; body: string; color: string}): void;
export function clearPins(): void;
// (next) export async function loadGLB(fileIdOrUrl: string, token?: string): Promise<void>;

// pins.js
export function setupPins(): void;
// (next) loadPinsFor(modelId), savePinsFor(modelId, pins[])
```

---

If you want, I can also produce a **checklist** version of this doc for code reviews and PR templates.
