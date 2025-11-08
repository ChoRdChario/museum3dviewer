// material.id.unify.v1.js  — drop-in, guarded version
(() => {
  const TAG='[mat-id-unify]';
  const log=(...a)=>console.log(TAG,...a), warn=(...a)=>console.warn(TAG,...a);

  // Try to resolve canonical panel where the modern Material UI should live
  const root = document.querySelector('#panel-material') || (() => {
    const tabBar = document.querySelector('#right [role="tablist"], #right .tabs, #right nav, #right header') || document.querySelector('#right') || document.body;
    const s = document.createElement('section');
    s.id = 'panel-material';
    s.className = 'lm-panel-material card';
    s.style.marginTop = '8px';
    tabBar && tabBar.insertAdjacentElement('afterend', s);
    log('synthesized #panel-material');
    return s;
  })();

  const legacyPane = document.querySelector('#pane-material');

  // === guard: if modern anchors already exist under #panel-material, skip synthesize/mirroring
  const hasModern = !!(root && (root.querySelector('#materialSelect') || root.querySelector('#opacityRange')));
  // Also remove accidentally inserted modern anchors under legacy containers
  if (legacyPane) {
    legacyPane.querySelectorAll('#materialSelect,#opacityRange').forEach(n => n.remove());
  }

  // One-time CSS to hide old pm-* controls if they exist
  (function injectCSS(){
    const cssId = '__lm_mat_unify_css__';
    if (document.getElementById(cssId)) return;
    const st = document.createElement('style');
    st.id = cssId;
    st.textContent = `
      #pane-material select#pm-material,
      #pane-material input#pm-opacity-range { display:none !important; }
    `;
    document.head.appendChild(st);
  })();

  if (hasModern) {
    log('modern anchors present -> skip synthesize');
    return;
  }

  // ---- create canonical anchors once (only if missing) ----
  function ensure(id, maker) {
    let n = root.querySelector('#' + id);
    if (!n) {
      n = maker();
      n.id = id;
      root.appendChild(n);
      log('created', '#' + id, 'under #panel-material');
    }
    return n;
  }

  ensure('materialSelect', () => {
    const el = document.createElement('select');
    el.setAttribute('aria-label','Select material');
    el.style.width = '100%';
    return el;
  });

  ensure('opacityRange', () => {
    const el = document.createElement('input');
    el.type='range'; el.min='0'; el.max='1'; el.step='0.01'; el.value='1.0';
    el.style.width='100%';
    return el;
  });

  log('unified', {
    selectParent: (document.getElementById('materialSelect')||{}).parentElement?.id || null,
    rangeParent:  (document.getElementById('opacityRange')||{}).parentElement?.id  || null
  });

  // Nudge orchestrators waiting for anchors
  try { window.dispatchEvent(new Event('lm:mat-ui-ready', {bubbles:true})); } catch(_){}
})();
