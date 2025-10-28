// material.orchestrator.js
// Neutralized shim to avoid clashes with new material.ui.orch.js
// Keeps legacy <script> references harmless without touching the DOM.

if (!window.__LM_MAT_ORCH_SHIM__) {
  window.__LM_MAT_ORCH_SHIM__ = true;
  // minimal, no DOM writes, no polling
  console.log('[lm-orch:shim] active (no-op)');
}
