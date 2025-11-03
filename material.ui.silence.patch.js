
/* material.ui.silence.patch.js — align with commit-mode */
(function(){
  window.__LM_COMMIT_MODE = true; // make sure orchestrator uses commit-mode
  console.log('[silence-patch v3.0] commit-mode enforced');
  // No DOM polling here anymore; commit-mode orchestration will handle reflection safely.
})();
