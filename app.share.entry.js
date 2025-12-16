// LociMyu - app.share.entry.js
// Share entry (Phase 1 scaffolding).
// New policy: Share mode loads a reduced, safe set. Write-capable modules are not loaded.
// This build wires the loader + guard + basic UI notice. Viewer wiring will be added in the next step.

import './share.fetch.guard.js';

function markLoaded(src) {
  try { (window.__LM_DIAG?.loaded || (window.__LM_DIAG.loaded=[])).push(src); } catch(_e) {}
}

function appendInline(code) {
  const s = document.createElement('script');
  s.textContent = code || '';
  (document.body || document.documentElement).appendChild(s);
}

function showNotice() {
  const right = document.querySelector('#right') || document.body;
  const box = document.createElement('div');
  box.className = 'panel';
  box.style.borderColor = '#3a3f46';
  box.innerHTML = `
    <h4>Share Mode</h4>
    <div style="opacity:.9">
      This build is running the new Share architecture (safe-by-design: write modules are not loaded).
      Viewer wiring (read-only Drive/Sheets, find-only locator, and read-only controllers) will be enabled in the next step.
    </div>
    <div style="margin-top:10px; opacity:.85">
      Diagnostics: open Console and run <code>__LM_DIAG.loaded</code> to verify loaded modules.
    </div>
  `;
  right.prepend(box);

  // Disable obvious "edit" affordances if they exist in DOM (best-effort only).
  const disableIds = ['btnSave','btnSaveView','btnSaveMaterial','btnAddCaption','btnNewSheet'];
  disableIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = true;
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
    }
  });
}

console.log('[lm-entry] Share entry starting…');

// Re-enable tab switching logic (was previously inline in index.html).
markLoaded('inline:tabs');
appendInline("\n    (function(){\n      const tabs = document.querySelectorAll('[role=\"tab\"]');\n      const panes = document.querySelectorAll('.pane');\n      tabs.forEach(t => t.addEventListener('click', () => {\n        tabs.forEach(x => x.setAttribute('aria-selected', String(x===t)));\n        panes.forEach(p => p.dataset.active = String(p.dataset.pane===t.dataset.tab));\n      }));\n    })();\n  ");

showNotice();
console.log('[lm-entry] Share entry ready (scaffolding).');
