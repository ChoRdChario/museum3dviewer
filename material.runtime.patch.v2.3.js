/* material.runtime.patch.js v2.3
 * - Single source of truth for Material panel DOM
 * - De-dup and re-home controls into the Per‑material opacity card
 * - Guard against multiple boots
 * - Keeps one <select> (#mat-select) and one <input type="range"> (#mat-range)
 */
(function () {
  const TAG = '[mat-rt v2.3]';
  if (window.__LM_MAT_RT_ACTIVE) {
    console.debug(TAG, 'already active; skip');
    return;
  }
  window.__LM_MAT_RT_ACTIVE = true;

  const qs = (s, r = document) => r.querySelector(s);
  const qsa = (s, r = document) => Array.from(r.querySelectorAll(s));

  // 1) Find Per-material opacity card or synthesize minimal container
  function ensureOpacityCard() {
    // known ids/classes seen in project
    let card = qs('#pm-opacity') ||
               qs('#pane-material .pm-opacity') ||
               (function (){
                 const hdr = Array.from(document.querySelectorAll('.card,section,div'))
                   .find(el => /Per\-material opacity/i.test(el.textContent || ''));
                 return hdr || null;
               })();
    if (!card) {
      // create within #panel-material to keep scope tight
      const host = qs('#panel-material') || qs('#pane-material') || qs('#material-pane') || qs('.lm-panel-material');
      if (!host) return null;
      card = document.createElement('section');
      card.id = 'pm-opacity';
      card.className = 'pm-card card';
      card.innerHTML = `
        <div class="pm-title">Per-material opacity (saved per sheet)</div>
        <div class="pm-help small">Pick a material, then set its opacity. This does not change global opacity above.</div>
        <div class="pm-row">
          <div class="pm-slot-select"></div>
          <div class="pm-slot-value small" id="pm-value" style="margin-left:auto;">1.00</div>
        </div>
        <div class="pm-row">
          <div class="pm-slot-range" style="width:100%"></div>
        </div>`;
      host.prepend(card);
    } else {
      // ensure slots exist
      if (!qs('.pm-slot-select', card)) {
        const row = document.createElement('div');
        row.className = 'pm-row';
        row.innerHTML = `<div class="pm-slot-select"></div><div class="pm-slot-value small" id="pm-value" style="margin-left:auto;">1.00</div>`;
        card.prepend(row);
      }
      if (!qs('.pm-slot-range', card)) {
        const row2 = document.createElement('div');
        row2.className = 'pm-row';
        row2.innerHTML = `<div class="pm-slot-range" style="width:100%"></div>`;
        card.appendChild(row2);
      }
    }
    return card;
  }

  function normalizeRangeInput(el) {
    if (!el) return;
    el.type = 'range';
    el.min = '0';
    el.max = '1';
    el.step = '0.01';
    el.id = 'mat-range';
    el.classList.add('pm-range');
  }

  function normalizeSelect(el) {
    if (!el) return;
    el.id = 'mat-select';
    el.classList.add('pm-select');
  }

  // Move first select/range into slots; remove duplicates
  function consolidate() {
    const card = ensureOpacityCard();
    if (!card) return false;
    const slotSelect = qs('.pm-slot-select', card);
    const slotRange = qs('.pm-slot-range', card);
    const slotValue = qs('#pm-value', card);

    const selects = qsa('#panel-material select, #pane-material select');
    const ranges  = qsa('#panel-material input[type="range"], #pane-material input[type="range"]');

    // De-dup select
    const sel = selects[0];
    selects.slice(1).forEach(e => e.remove());
    if (sel) {
      normalizeSelect(sel);
      if (!slotSelect.contains(sel)) slotSelect.appendChild(sel);
    } else {
      // synthesize empty select to keep layout stable
      const s = document.createElement('select');
      normalizeSelect(s);
      slotSelect.appendChild(s);
    }

    // De-dup range
    const rng = ranges[0];
    ranges.slice(1).forEach(e => e.remove());
    if (rng) {
      normalizeRangeInput(rng);
      if (!slotRange.contains(rng)) slotRange.appendChild(rng);
    } else {
      const r = document.createElement('input');
      r.type = 'range';
      normalizeRangeInput(r);
      slotRange.appendChild(r);
    }

    // Value mirror
    const rangeEl = qs('#mat-range', card);
    if (rangeEl && slotValue) {
      const val = (parseFloat(rangeEl.value || '1') || 1).toFixed(2);
      slotValue.textContent = val;
      rangeEl.addEventListener('input', () => {
        slotValue.textContent = (parseFloat(rangeEl.value || '1') || 1).toFixed(2);
      }, {passive: true});
    }

    return true;
  }

  // Initial consolidate
  consolidate();

  // Observe for late DOM inserts from other scripts (dropdown patches etc.)
  const host = qs('#panel-material') || document.body;
  let locked = false;
  const mo = new MutationObserver(() => {
    if (locked) return;
    locked = true;
    // give other scripts a tick to finish
    setTimeout(() => {
      try { consolidate(); } finally {
        locked = false;
      }
    }, 0);
  });
  mo.observe(host, {childList: true, subtree: true});

  // auto-stop once stable for a while (prevents infinite patching)
  let last = Date.now();
  const iv = setInterval(() => {
    const now = Date.now();
    if (now - last > 1200) {
      console.debug(TAG, 'stabilized; observer disconnected');
      try { mo.disconnect(); } catch {}
      clearInterval(iv);
    } else {
      last = now;
    }
  }, 300);

  console.debug(TAG, 'wired');
})();
