
/* material.ui.anchors.js
 * v1 — Ensure a canonical #pane-material panel and required anchors exist
 * This must run BEFORE material.orchestrator.js
 */
(() => {
  const TAG='[mat-ui-anchors v1]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);
  const doc = document;

  // 1) Ensure right-side container
  const right = doc.querySelector('#right, aside, .right, .sidebar') || doc.body;

  // 2) Tab bar (used as insert reference)
  const tabBar = right.querySelector('[role="tablist"], .tabs, nav, header') || right;

  // 3) Ensure material pane with the EXACT id the orchestrator expects
  let pane = right.querySelector('#pane-material');
  if (!pane) {
    pane = doc.createElement('section');
    pane.id = 'pane-material';
    pane.className = 'card';
    pane.style.marginTop = '8px';
    tabBar.insertAdjacentElement('afterend', pane);
    log('synthesized #pane-material');
  }

  // 4) Ensure anchors inside the pane with the EXACT ids the orchestrator queries
  function ensure(id, tag, init){
    let el = pane.querySelector('#'+id) || doc.getElementById(id);
    if (!el) {
      el = doc.createElement(tag);
      el.id = id;
      typeof init === 'function' && init(el);
      pane.appendChild(el);
      log('created anchor', '#'+id);
    } else if (!pane.contains(el)) {
      pane.appendChild(el);
      log('moved anchor into pane', '#'+id);
    }
    return el;
  }

  const sel = ensure('materialSelect', 'select', (e)=>{ e.style.width='100%'; });
  const rng = ensure('opacityRange', 'input', (e)=>{ e.type='range'; e.min='0'; e.max='1'; e.step='0.01'; e.value='1.0'; e.style.width='100%'; });

  // Optional toggles (orchestrator may bind if present)
  ensure('doubleSided','input', e=>{ e.type='checkbox'; });
  ensure('unlitLike','input',  e=>{ e.type='checkbox'; });

  // 5) Signal readiness for late binders
  try {
    window.dispatchEvent(new Event('lm:mat-ui-ready', { bubbles: true }));
  } catch {}
  log('anchors ready', { pane: !!pane, sel: !!sel, rng: !!rng });
})();
