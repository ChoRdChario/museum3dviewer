/* mat_runtime_fix.js v3.0 (idempotent, single-execution)
 * Purpose: Ensure a single, canonical Material pane UI exists and expose handles via window.__LM_MAT_UI
 * Notes:
 *  - Reuses existing DOM when present; otherwise creates minimal required nodes.
 *  - Does not attach any business logic; just prepares UI elements.
 */
(function () {
  const TAG = "[mat-rt v3.0]";

  if (window.__LM_MAT_RT_INITED) {
    console.debug(TAG, "already initialized (no-op)");
    return;
  }

  function ensureEl(parent, selector, create) {
    let el = parent.querySelector(selector);
    if (!el) {
      el = create();
      parent.appendChild(el);
    }
    return el;
  }

  function findPanelMaterial() {
    // Prefer canonical panel if present
    let panel = document.getElementById("panel-material");
    if (panel) return panel;

    // Fallback: synthesize minimal card under right pane if known containers exist
    const right = document.getElementById("right") || document.querySelector(".right-pane") || document.body;
    panel = document.createElement("section");
    panel.id = "panel-material";
    panel.className = "lm-panel-material card";
    panel.style.marginTop = "8px";
    right.appendChild(panel);
    console.debug(TAG, "synthesized panel", panel);
    return panel;
  }

  const panel = findPanelMaterial();

  // Ensure the opacity block (canonical section) exists
  let sec = panel.querySelector("#pm-opacity");
  if (!sec) {
    sec = document.createElement("div");
    sec.id = "pm-opacity";
    sec.className = "pm-block";
    sec.innerHTML = [
      '<h3 style="margin:6px 0;">Per‑material opacity <small>(saved per sheet)</small></h3>',
      '<div class="row" style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">',
      '  <select id="mat-select" style="min-width:160px;"></select>',
      '  <input id="mat-range" type="range" min="0" max="1" step="0.01" value="1" style="flex:1 1 180px;">',
      '  <input id="pm-value" type="number" min="0" max="1" step="0.01" value="1" style="width:80px;">',
      '</div>'
    ].join("");
    panel.appendChild(sec);
  }

  // Resolve handles with graceful fallback (reuse if different ids exist)
  const select = sec.querySelector("#mat-select") || sec.querySelector("select");
  const range = sec.querySelector("#mat-range") || sec.querySelector('input[type="range"]');
  const valueDisplay = sec.querySelector("#pm-value") || sec.querySelector('input[type="number"]');

  // Basic mutual UI sync (no scene touch here)
  function clamp01(v) {
    v = Number(v);
    if (Number.isNaN(v)) return 1;
    return Math.max(0, Math.min(1, v));
  }
  range.addEventListener("input", () => {
    valueDisplay.value = clamp01(range.value).toFixed(2);
  }, { passive: true });
  valueDisplay.addEventListener("input", () => {
    const v = clamp01(valueDisplay.value);
    valueDisplay.value = v.toFixed(2);
    range.value = String(v);
  }, { passive: true });

  window.__LM_MAT_UI = { card: panel, section: sec, select, range, valueDisplay };
  window.__LM_MAT_RT_INITED = true;
  console.debug(TAG, "ready", window.__LM_MAT_UI);
})();