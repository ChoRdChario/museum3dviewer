# CHANGELOG — materials-header-guard v1.2

**2025-11-10 17:21:55**

- Add non-invasive overlay that unifies `__LM_MATERIALS` sheet creation and A1:R1 header write.
- Guarantees order: create sheet → verify A1 → write header if needed.
- Correct A1 range handling with `encodeURIComponent("__LM_MATERIALS")+"!A1:R1"` (no stray quotes).
- Single-flight guard to coalesce concurrent calls; light in-flight map for meta fetches.
- Listens to `lm:sheet-context` and runs once per distinct spreadsheetId (200ms debounce).
- Exposes safe `window.ensureMaterialsHeader` override; falls back to previous implementation on failure.
- Adds concise logging under `[materials.header.guard]`.
