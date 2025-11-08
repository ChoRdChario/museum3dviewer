/*! material.runtime.patch.js v3.1 (safe, non-destructive)
 * - Creates the Material pane controls ONLY if missing.
 * - Never removes or rewrites existing Caption/Views UIs.
 * - Attaches handles on window.__LM_MAT_UI for other scripts.
 */
(function(){
  const TAG='[mat-rt v3.1]';
  if (window.__LM_MAT_RT_DONE) { console.debug(TAG,'already ready'); return; }

  // Anchor: an existing Material panel is preferred
  const panel = document.querySelector('#panel-material') 
             || document.querySelector('.lm-panel-material')
             || (()=>{
                  // last resort: find tab content that includes heading "Material"
                  const cards=[...document.querySelectorAll('.card, section, div')];
                  return cards.find(el => /material/i.test(el.id||'') || /material/i.test(el.textContent||''));
                })();

  if (!panel) { console.warn(TAG,'panel not found; skip'); return; }

  // Build opacity block if absent
  let block = panel.querySelector('#pm-opacity');
  if (!block) {
    block = document.createElement('div');
    block.id = 'pm-opacity';
    block.className = 'pm-opacity block';
    block.style.marginTop = '8px';
    block.innerHTML = [
      '<div class="subhead" style="font-size:12px;opacity:.7;margin-bottom:6px;">Per‑material opacity (saved per sheet)</div>',
      '<div class="row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">',
      '  <select id="pm-material" class="input" style="flex:1 1 auto;min-width:160px;"></select>',
      '  <input id="pm-opacity-range" type="range" min="0" max="1" step="0.01" value="1" style="flex:1 1 180px;">',
      '  <output id="pm-opacity-val" style="width:3.6em;text-align:right;">1.00</output>',
      '</div>',
      '<div class="hint" style="font-size:11px;opacity:.6;">Pick a material, then set its opacity. This does not change global opacity above.</div>'
    ].join('');
    // Insert near top but keep existing content
    panel.prepend(block);
  }

  // Expose handles
  window.__LM_MAT_UI = {
    panel,
    block,
    select: block.querySelector('#pm-material'),
    range:  block.querySelector('#pm-opacity-range'),
    out:    block.querySelector('#pm-opacity-val'),
    __ready: true
  };

  // Minimal placeholder option if empty
  const sel = window.__LM_MAT_UI.select;
  if (sel && !sel.options.length) {
    const opt = document.createElement('option');
    opt.value = ''; opt.textContent = '— select material —';
    sel.appendChild(opt);
  }

  console.debug(TAG,'ready');
  window.__LM_MAT_RT_DONE = true;
})();
