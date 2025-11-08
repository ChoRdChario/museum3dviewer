// material.runtime.patch.js
// v2.1 - enforce single opacity UI (select + range + readout) under #pm-opacity
// Also guards duplicate event wiring and stale legacy controls.
console.log('[mat-rt v2.1] start');

(() => {
  const PANEL_ID = 'pm-opacity';
  const RANGE_ID = 'materialOpacity';
  const SELECT_ID = 'materialSelect';
  const READOUT_CLASS = 'mat-op-readout';

  // Singleton guard per page
  if (window.__lm_mat_rt_v21) {
    console.log('[mat-rt v2.1] already active');
    return;
  }
  window.__lm_mat_rt_v21 = true;

  const ensureStructure = () => {
    const panel = document.getElementById(PANEL_ID) || document.querySelector('#panel-material #pm-opacity') || document.querySelector('#pane-material #pm-opacity');
    if (!panel) return;

    // Remove legacy duplicate blocks that might have been injected before
    // Keep the first range + first select. Remove others.
    const ranges = panel.querySelectorAll('input[type="range"]');
    for (let i = 0; i < ranges.length; i++) {
      const r = ranges[i];
      // normalize attributes
      r.min = r.min || "0";
      r.max = r.max || "1";
      r.step = r.step || "0.01";
      r.id = r.id || RANGE_ID;
      r.removeAttribute('disabled');
      r.style.pointerEvents = 'auto';
      r.style.touchAction = 'none';
      if (i > 0) {
        r.parentElement && r.parentElement.removeChild(r);
      }
    }

    const selects = panel.querySelectorAll('select');
    for (let i = 0; i < selects.length; i++) {
      const s = selects[i];
      s.id = s.id || SELECT_ID;
      s.removeAttribute('disabled');
      if (i > 0) {
        s.parentElement && s.parentElement.removeChild(s);
      }
    }

    // Readout badge (single)
    let readout = panel.querySelector('.' + READOUT_CLASS);
    if (!readout) {
      readout = document.createElement('div');
      readout.className = READOUT_CLASS;
      readout.textContent = '';
      // place directly under panel header block if exists, else append
      panel.appendChild(readout);
    }

    // If range exists, keep its sibling numeric badge unique
    const updateReadout = () => {
      const range = panel.querySelector('#' + RANGE_ID) || panel.querySelector('input[type="range"]');
      if (!range) return;
      const v = (Number(range.value)).toFixed(2);
      readout.textContent = v;
    };
    updateReadout();

    // Wire once
    const range = panel.querySelector('#' + RANGE_ID) || panel.querySelector('input[type="range"]');
    if (range && !range.__lm_rt_bound) {
      range.__lm_rt_bound = true;
      range.addEventListener('input', updateReadout, {passive:true});
    }

    // Clean up any stray numeric texts showing the same value under pm-opacity (old UI)
    const numericBadges = panel.querySelectorAll('span,div');
    let keptOne = false;
    numericBadges.forEach(el => {
      if (el === readout) return;
      const t = (el.textContent || '').trim();
      if (/^0?\.\d{1,3}$|^1(\.0+)?$/.test(t)) {
        if (!keptOne) {
          // keep only the generated readout, remove others
          if (el.parentElement) el.parentElement.removeChild(el);
          keptOne = true;
        } else {
          if (el.parentElement) el.parentElement.removeChild(el);
        }
      }
    });

    // Remove any duplicated field rows that might be produced by previous injections
    const rows = panel.querySelectorAll('.field, .row, .lm-row');
    const seen = new Set();
    rows.forEach(r => {
      const sig = r.innerHTML.replace(/\s+/g,' ').slice(0,160);
      if (seen.has(sig)) {
        r.remove();
      } else {
        seen.add(sig);
      }
    });
  };

  const mo = new MutationObserver(() => {
    ensureStructure();
  });

  const arm = () => {
    const target = document.getElementById(PANEL_ID) || document.querySelector('#panel-material') || document.querySelector('#pane-material');
    if (!target) return false;
    mo.observe(target, {childList:true, subtree:true});
    ensureStructure();
    console.log('[mat-rt v2.1] wired');
    return true;
  };

  // Try now; also on DOMContentLoaded
  if (!arm()) {
    document.addEventListener('DOMContentLoaded', arm, {once:true});
    // soft poll (short time) in case UI is synthesized after boot
    let tries = 0;
    const id = setInterval(() => {
      if (arm() || ++tries > 40) clearInterval(id);
    }, 100);
  }
})();
