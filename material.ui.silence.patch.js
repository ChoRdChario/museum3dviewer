
/*!
 * material.ui.silence.patch.js — v2.1
 * Guards against accidental cross-material writes by silencing programmatic UI events
 * right after material selection changes. Safe overlay, no edits to orchestrator.
 */
(() => {
  // Singleton guard
  if (window.__LM_SILENCE_PATCH__) {
    try { console.debug('[silence-patch v2.1] already installed'); } catch {}
    return;
  }

  const patch = window.__LM_SILENCE_PATCH__ = {
    version: '2.1',
    endAt: 0,
    lastUserEl: null,
    lastUserTs: 0,
    boundSel: null
  };

  const now = () => performance.now();
  const log = (...a) => { try { console.log('[silence-patch v2.1]', ...a); } catch {} };

  // Utility: find the material panel container dynamically every time (no global const that can re-declare)
  const findPanel = () => {
    // Try to locate via the select first
    const sel = document.querySelector('#pm-material, select[aria-label="Select material"]');
    if (sel?.closest) return sel.closest('section, .card, .panel, .vstack, .stack, div');
    // Fallback: any container that has the per-material opacity label
    const lbl = Array.from(document.querySelectorAll('*')).find(n => /Per-?material opacity/i.test(n.textContent || ''));
    return lbl?.closest?.('section, .card, .panel, .vstack, .stack, div') || document.body;
  };

  const isInPanel = (el) => {
    try {
      const p = findPanel();
      return !!(el && p && (el===p || (el.closest && el.closest('*') && p.contains(el))));
    } catch { return false; }
  };

  // CSS toggle for pointer-events none during silence window
  const STYLE_ID = 'lm-silence-style';
  if (!document.getElementById(STYLE_ID)) {
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `.lm-silence-pe{pointer-events:none !important;}`;
    document.head.appendChild(st);
  }

  // Open/extend the silence window
  let peTimer = null;
  const openSilence = (ms, reason) => {
    const until = now() + (ms|0);
    if (until > patch.endAt) patch.endAt = until;
    const panelEl = findPanel();
    if (panelEl && !panelEl.classList.contains('lm-silence-pe')) {
      panelEl.classList.add('lm-silence-pe');
    }
    if (peTimer) clearTimeout(peTimer);
    peTimer = setTimeout(() => {
      const p = findPanel();
      if (p) p.classList.remove('lm-silence-pe');
    }, Math.max(40, ms));
    log(`silence ${ms|0}ms ${reason?`(${reason})`:''}`);
  };

  // Capture user-intent (these should not be blocked)
  const userMark = (e) => {
    patch.lastUserEl = e.target;
    patch.lastUserTs = now();
  };
  document.addEventListener('pointerdown', userMark, true);
  document.addEventListener('keydown', userMark, true);

  // Core guard: stop synthetic programmatic inputs during the silence window
  const guard = (e) => {
    if (!isInPanel(e.target)) return;
    const t = now();
    const userRecent = (patch.lastUserEl === e.target) && (t - patch.lastUserTs < 400);
    if (userRecent) return; // let genuine user actions pass
    if (t < patch.endAt) {
      try { e.stopImmediatePropagation(); e.preventDefault(); } catch {}
      log('blocked', e.type, e.target?.tagName || '(node)');
    }
  };
  document.addEventListener('input', guard, true);
  document.addEventListener('change', guard, true);

  // Mutation observer to extend silence when programmatic value flips happen
  const mo = new MutationObserver((muts) => {
    let bump = false;
    for (const m of muts) {
      if (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'checked')) {
        if (isInPanel(m.target)) { bump = true; break; }
      }
    }
    if (bump) openSilence(140, 'mutation');
  });
  const observePanel = () => {
    try {
      const p = findPanel();
      if (p) mo.observe(p, {subtree: true, attributes: true, attributeFilter: ['value','checked']});
    } catch {}
  };
  observePanel();

  // Material select binding (bind once, but tolerate rewires by polling)
  const bindSelect = () => {
    const sel = document.querySelector('#pm-material, select[aria-label="Select material"]');
    if (!sel || patch.boundSel === sel) return;
    const onSel = () => openSilence(260, 'select-change');
    sel.addEventListener('change', onSel, true);
    sel.addEventListener('input', onSel, true);
    patch.boundSel = sel;
    log('hooked select for silence');
  };
  bindSelect();
  const rebindTimer = setInterval(bindSelect, 5000);

  // Safety: clear interval on unload
  window.addEventListener('beforeunload', () => clearInterval(rebindTimer));

  log('installed');
})();
