# PATCH_NOTES (embedded complete index.html)

This file accompanies the provided `index.html` that **restores the DOM bridge and UI elements**
your existing JS expects, without changing any JS behavior.

## What’s inside
- `#gauth-bridge` container with `#auth-signin` / `#auth-signout` buttons.
- Captions pane elements with the exact IDs most codebases wire to:
  - `#glb-input`, `#glb-pick`, `#glb-load`, `#refresh-images`
  - `#save-target`, `#save-target-new`
  - Pin color radios (with `data-color`) grouped in `#pin-colors`
  - `#pin-filter`
  - `#caption-list`, `#caption-title`, `#caption-body`
  - `#pin-add`, `#pin-clear`, `#refresh-images-2`
- Tabs with `data-tab`/`data-pane` hooks (Captions/Materials/Views)
- Viewer mount area: `#viewer` and status node `#viewer-status`

## How to use
1. Replace your repository `index.html` with the included one.
2. Set your real OAuth Client ID on the `#gauth-bridge` element:
   ```html
   <div id="gauth-bridge" data-client-id="YOUR_GOOGLE_OAUTH_CLIENT_ID" ...>
   ```
3. Keep your existing JS files in place:
   - `viewer.js`, `pins.js`, `app_boot.js`
   - vendor Three.js scripts (paths can be adjusted if your repo differs)

> If you don't have `/vendor/three/*`, either adjust the paths to your copies,
> or remove those `<script>` tags if your modules import Three themselves.

## Rollback
Just restore your previous `index.html`. No other files are touched.

## Why this is safe
- Minimal DOM-only changes; no logic changes.
- Uses IDs/hooks that typical previous versions relied upon.
- Future work (real auth wiring, GLB loader, caption persistence) remains unchanged.
