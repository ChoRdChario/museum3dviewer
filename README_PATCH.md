
# LociMyu ESM-Lite Patch

This bundle migrates your runtime to ES Modules **without changing your UI layout**.

## Files

- `boot.esm.js` — ESM bootstrap. Replace previous `<script src="...">` tags with:
  ```html
  <script type="module" src="./boot.esm.js"></script>
  ```
  It auto-detects existing element IDs (GLB button / input / sign-in button) and wires them up.

- `viewer.module.js` — ESM viewer. No global `window.Viewer` required; everything is imported.

## Vendor dependencies (place in repo)

```
/lib/three/build/three.module.js
/lib/three/examples/jsm/controls/OrbitControls.js
/lib/three/examples/jsm/loaders/GLTFLoader.js
```

> Ensure paths and letter case exactly match. We recommend Three r155+.

## What to remove from HTML

- Old `<script src="three.min.js">`, `<script src="OrbitControls.js">` etc.
- Old `viewer.js`, `app_boot.js` script tags.
- Keep **all your DOM** as-is; this patch doesn't touch layout.

## Notes

- Google Drive GLB loading supports `fileId` or share URL. We normalize to `uc?export=download&id=...` and fetch with `Authorization: Bearer <token>` from `gauth.module.js`.
- If some of your element IDs differ, add them to the `q([...])` list in `boot.esm.js` (non-breaking).
