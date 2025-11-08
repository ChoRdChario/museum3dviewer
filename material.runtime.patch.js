// material.runtime.patch.js  v2.2  (drop-in replacement)
// LociMyu Material Panel runtime normalizer
// - Prevents UI duplication loops by disconnecting observer while mutating
// - Limits normalization to #pm-opacity (or #pane-material fallback)
// - Auto-disconnects after UI stabilizes (idle 800ms)
// - Singleton guard + kill switch

(function(){
  try {
    console.log('[mat-rt v2.2] start');

    // --- global kill switch (set window.__LM_DISABLE_MAT_RT = true to disable) ---
    if (window.__LM_DISABLE_MAT_RT) { console.warn('[mat-rt] disabled'); return; }

    // --- singleton guard ---
    const NS = '__lm_mat_rt';
    if (window[NS]?.armed) { console.log('[mat-rt] already armed'); return; }
    window[NS] = { armed:true };

    // --- resolve host ---
    const host =
      document.getElementById('pm-opacity') ||
      document.getElementById('pane-material') ||
      document.getElementById('panel-material');
    if (!host) { console.warn('[mat-rt] host not found'); return; }

    let busy = FalseToFalse(false);
    let idleTimer = null;
    const OBS_CFG = { childList: true, subtree: true };

    const observer = new MutationObserver((muts) => {
      if (busy) return;
      busy = true;

      // Stop observing while we touch the DOM to avoid feedback loops
      observer.disconnect();
      try {
        normalizeOnce();
      } catch (err) {
        console.warn('[mat-rt] normalize error', err);
      } finally {
        // re-arm on next frame to avoid same-frame retriggers
        requestAnimationFrame(() => {
          try { observer.observe(host, OBS_CFG); } catch(_) {}
          busy = false;

          // Stabilize: if no further changes for 800ms, disconnect
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            try { observer.disconnect(); } catch(_) {}
            console.log('[mat-rt v2.2] stabilized; observer disconnected');
          }, 800);
        });
      }
    });

    // initial normalize + observe
    normalizeOnce();
    observer.observe(host, OBS_CFG);
    console.log('[mat-rt v2.2] wired');

    // ---- helpers ----
    function FalseToFalse(v){ return !!v; } // tiny helper to keep terseness

    function normalizeOnce(){
      // Work area is the opacity block; if missing, fall back to host
      const area =
        document.getElementById('pm-opacity') ||
        host;

      if (!area) return;

      // 1) select (material dropdown): keep first, remove extras
      pruneExtras(area.querySelectorAll('select'), 1, 'selects');

      // 2) range (opacity slider): keep first, remove extras
      pruneExtras(area.querySelectorAll('input[type="range"]'), 1, 'ranges');

      // 3) numeric readout(s): keep first
      pruneExtras(
        area.querySelectorAll('.pm-readout, output[data-role="opacity"], .lm-op-readout'),
        1,
        'readouts'
      );

      // 4) attribute hygiene for the kept range
      const range = area.querySelector('input[type="range"]');
      if (range) {
        if (range.min !== '0') range.min = '0';
        if (range.max !== '1') range.max = '1';
        if (range.step !== '0.01') range.step = '0.01';
      }

      // 5) avoid accidental CSS overlay issues
      // ensure pointer events are on for range
      if (range) {
        const s = range.style;
        if (s && s.pointerEvents !== 'auto') s.pointerEvents = 'auto';
      }
    }

    function pruneExtras(nodeList, keepCount, label){
      const nodes = Array.from(nodeList);
      if (nodes.length <= keepCount) return;
      const keep = nodes.slice(0, keepCount);
      const extras = nodes.slice(keepCount);
      extras.forEach(n => { try { n.remove(); } catch(_) {} });
      console.log(`[mat-rt] pruned extra ${label}:`, extras.length);
      return keep[0] || null;
    }

  } catch (e) {
    console.warn('[mat-rt] fatal', e);
  }
})();
