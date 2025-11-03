/*!
 * LociMyu material UI silence & reflect patch
 * v2.2 (auto-reflect selected material state into UI without persisting)
 * - Prevents cross-material "value bleed" during selection
 * - Immediately syncs UI controls (e.g., opacity slider) to the newly selected material
 * - Singleton + safe on multiple script injections
 */
(() => {
  const NS = '__LM_SILENCE_PATCH__';
  if (window[NS]?.installed) {
    // already installed, but refresh hooks in case DOM changed
    try { window[NS].rehook?.(); } catch {}
    console.log('[silence-patch v2.2] already installed -> rehooked');
    return;
  }

  // --- internal state --------------------------------------------------------
  const state = {
    until: 0,
    reason: '',
    lastSelectedName: null,
  };

  // utilities
  const now = () => performance.now();
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
  const visible = el => !!(el && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && getComputedStyle(el).display!=='none');

  // candidate selectors (be conservative & non-destructive)
  const SEL = {
    materialSelect: '#pm-material, select[aria-label="Select material"], #materialSelect, #mat-select, #matKeySelect, select[name*="material"], select[id*="material"]',
    opacityRange:   '#pm-opacity, #opacityRange, input[type="range"][name*="opac"], input[type="range"][id*="opac"]',
    opacityNumber:  '#pm-opacity-number, input[type="number"][name*="opac"], input[type="number"][id*="opac"]',
  };

  function isSilenced() {
    return now() < state.until;
  }

  function openSilence(ms=260, reason='') {
    state.until = now() + ms;
    state.reason = reason || 'ui-change';
    // optional: dim pointer events for a flicker-free instant
    const host = document.getElementById('pm-panel') || document.body;
    host.style.setProperty('--lm-silence', '1');
    host.style.pointerEvents = 'none';
    setTimeout(() => {
      host.style.pointerEvents = '';
      host.style.removeProperty('--lm-silence');
    }, ms + 20);
    console.log('[silence-patch v2.2] silence %dms (%s)', ms, state.reason);
  }

  // Stop programmatic change/input while silenced
  function installGlobalGuards() {
    const stopIf = (e) => {
      // Allow genuine user input (trusted) unless within silence window
      // The orchestrator dispatches programmatic events -> cancel during silence
      if (!isSilenced()) return;
      // Block only common control events
      if (e.type === 'change' || e.type === 'input') {
        // If event was initiated by this patch for reflect, mark and skip blocking
        if (e.detail && e.detail.__lm_reflect__) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
        // do NOT preventDefault to avoid fighting native UI
        console.log('[silence-patch v2.2] blocked %s %s', e.type.toUpperCase(), e.target?.tagName || '');
      }
    };
    window.addEventListener('change', stopIf, true);
    window.addEventListener('input',  stopIf, true);
  }

  // --- Scene / material helpers ---------------------------------------------
  function getBridge() {
    return window.__LM_VIEWER_BRIDGE__ || window.viewerBridge || window.LM_VIEWER_BRIDGE || {};
  }

  function sampleMaterialByName(name) {
    const br = getBridge();
    const sc = br?.getScene?.();
    if (!sc?.traverse || !name) return null;
    let pick = null;
    sc.traverse(o => {
      if (pick) return;
      if (!o?.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        const nm = (m.name || '').trim();
        if (!nm) continue;
        if (nm === name) { pick = m; break; }
      }
    });
    return pick;
  }

  function readMaterialState(name) {
    const m = sampleMaterialByName(name);
    if (!m) return null;
    // Normalize into a simple POJO the UI can consume. Extendable.
    const opacity = (typeof m.opacity === 'number') ? Math.max(0, Math.min(1, m.opacity)) : 1;
    return { opacity };
  }

  // --- UI reflecting WITHOUT persistence ------------------------------------
  function reflectOpacityUI(opacity) {
    // 0..1 expected
    const r = $(SEL.opacityRange);
    const n = $(SEL.opacityNumber);
    if (!r && !n) return false;

    // Mark custom detail so guards won't block our own dispatch
    const detail = { __lm_reflect__: true };

    if (r) {
      // honor range min/max if they are 0..1 or 0..100; try to infer
      const min = Number(r.min || 0);
      const max = Number(r.max || 1);
      let v = opacity;
      if (max > 1.5) v = Math.round(opacity * max); // e.g., max=100
      r.value = String(v);
      // Dispatch a light "input" so readouts update, but will be ignored by orchestrator during silence
      r.dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true, detail }));
    }
    if (n) {
      // number input often mirrors 0..100 or 0..1
      const min = Number(n.min || 0);
      const max = Number(n.max || 1);
      let v = opacity;
      if (max > 1.5) v = Math.round(opacity * max);
      n.value = String(v);
      n.dispatchEvent(new CustomEvent('input', { bubbles: true, composed: true, detail }));
    }
    return true;
  }

  function reflectAllUIFrom(name) {
    if (!name) return;
    const mat = readMaterialState(name);
    if (!mat) return;
    // Perform reflections **during** the silence window
    reflectOpacityUI(mat.opacity);
  }

  // --- Hook material select --------------------------------------------------
  function hookMaterialSelect(sel) {
    if (!sel || sel.__lm_silence_hooked__) return;
    sel.__lm_silence_hooked__ = true;
    sel.addEventListener('change', (e) => {
      // compute selected material name (prefer option text if value is uuid)
      const opt = sel.selectedOptions?.[0];
      const pickedName = (opt?.textContent || '').trim() || (sel.value || '').trim();
      state.lastSelectedName = pickedName;

      // Open silence, then reflect UI immediately in microtasks/RAFs
      openSilence(260, 'select-change');
      // Two RAFs to allow orchestrator to swap handlers/DOM safely
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          reflectAllUIFrom(pickedName);
        });
      });
    }, true);
    console.log('[silence-patch v2.2] hooked select for silence+reflect');
  }

  function rehook() {
    const sel = $(SEL.materialSelect);
    if (sel && visible(sel)) hookMaterialSelect(sel);
  }

  // Initialize
  installGlobalGuards();
  rehook();

  // Also observe late DOM
  const mo = new MutationObserver(() => rehook());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // expose tiny API for debugging
  window[NS] = { installed: true, rehook, openSilence, reflectAllUIFrom };
  console.log('[silence-patch v2.2] installed');
})();
