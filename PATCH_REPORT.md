# Patch Report (auto)

Generated: 2025-11-10T05:57:45.687755

## Touched files
- materials.sheet.persist.js
- sheet.ctx.bridge.js
- materials.sheet.bridge.js
- boot.esm.cdn.js
- viewer.module.cdn.js
- index.html

## Notes
- Added alias window.LM_MaterialsPersist = API;
- Wired LM_MaterialsPersist.setCtx on lm:sheet-context
- Disabled append & added thin adapter to LM_MaterialsPersist.upsert
- Delegated header creation to LM_MaterialsPersist.ensureHeaders()
- Rewired Three imports to import map
- Cleaned panel hide and ensured import map for three
