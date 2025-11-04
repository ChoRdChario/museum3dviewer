// material.orchestrator.js — V6_15_COMMIT_MODE+robust_ui_wait+pm_selectors
(() => {
  const VERSION_TAG = 'V6_15_COMMIT_MODE+robust_ui_wait+pm_selectors';
  console.log('[mat-orch] loaded VERSION_TAG:', VERSION_TAG);

  if (typeof window.__LM_COMMIT_MODE === 'undefined') window.__LM_COMMIT_MODE = true;

  const SELECTORS = {
    materialSelect: ['#pm-material', 
      '#materialSelect',
      'select[name="materialKey"]',
      '[data-lm="material-select"]',
      '.lm-material-select',
      '[data-testid="material-select"]',
      '#materialPanel select',
      '.material-panel select'
    ],
    opacityRange: ['#pm-opacity-range', 
      '#opacityRange',
      'input[type="range"][name="opacity"]',
      '[data-lm="opacity-range"]',
      '.lm-opacity-range',
      '[data-testid="opacity-range"]',
      '#materialPanel input[type="range"]',
      '.material-panel input[type="range"]'
    ]
  };

  function pick(qs) {
    for (const q of qs) {
      const el = document.querySelector(q);
      if (el) return el;
    }
    return null;
  }

  function waitForElement(qs, timeoutMs = 10000) {
    const existing = pick(qs);
    if (existing) return Promise.resolve(existing);

    return new Promise((resolve) => {
      const mo = new MutationObserver(() => {
        const el = pick(qs);
        if (el) {
          mo.disconnect();
          resolve(el);
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        mo.disconnect();
        console.warn('[mat-orch] UI not ready after wait; selectors tried:', qs);
        resolve(null);
      }, timeoutMs);
    });
  }

  const sheet = window.materialsSheetBridge || window.__materialsSheetBridge || {};
  const getOne = sheet.getOne ? sheet.getOne.bind(sheet) : async (materialKey) => (window.__LM_MOCK_SHEET?.[materialKey] ?? null);
  const upsertOne = sheet.upsertOne ? sheet.upsertOne.bind(sheet) : async ({ materialKey, opacity }) => {
    window.__LM_MOCK_SHEET = window.__LM_MOCK_SHEET || {};
    window.__LM_MOCK_SHEET[materialKey] = { opacity };
    return true;
  };

  const viewerBridge = window.viewerBridge || window.__viewerBridge || {};
  const getScene = viewerBridge.getScene ? viewerBridge.getScene.bind(viewerBridge) : () => (window.__LM_SCENE || null);

  let WIRED = false;
  let PROGRAM_SET = false;

  async function reflectFromSheet(selectEl, rangeEl) {
    const key = selectEl?.value;
    if (!key) return;
    try {
      const row = await getOne(key);
      if (row && row.opacity != null) {
        PROGRAM_SET = true;
        rangeEl.value = String(row.opacity);
        rangeEl.dispatchEvent(new Event('input', { bubbles: true }));
        PROGRAM_SET = false;
        console.log('[mat-orch] reflected from sheet:', key, '→', row.opacity);
      } else {
        console.log('[mat-orch] reflected from sheet: no row for', key);
      }
    } catch (e) {
      console.warn('[mat-orch] reflectFromSheet error', e);
    }
  }

  function applyPreview(rangeEl, selectEl) {
    const scene = getScene?.();
    if (!scene) return;
    const key = selectEl?.value;
    const opacity = parseFloat(rangeEl.value);
    if (!key || isNaN(opacity)) return;

    let count = 0;
    try {
      scene.traverse?.((obj) => {
        const mat = obj.material;
        if (!mat) return;
        const mats = Array.isArray(mat) ? mat : [mat];
        for (const m of mats) {
          if (m?.name === key) {
            if ('transparent' in m) m.transparent = opacity < 1.0;
            if ('opacity' in m) m.opacity = opacity;
            count++;
          }
        }
      });
    } catch {}
    console.log(`[mat-orch] opacity ${opacity.toFixed(2)} → "${key}" x${count}`);
  }

  async function wireCommitMode(selectEl, rangeEl) {
    if (WIRED) return;
    WIRED = true;
    console.log('[mat-orch] wired commit-mode');

    selectEl.addEventListener('change', () => reflectFromSheet(selectEl, rangeEl));

    let lastPreview = 0;
    rangeEl.addEventListener('input', () => {
      if (PROGRAM_SET) return;
      const now = performance.now();
      if (now - lastPreview < 16) return;
      lastPreview = now;
      applyPreview(rangeEl, selectEl);
    });

    async function commitOnce() {
      if (PROGRAM_SET) return;
      const key = selectEl?.value;
      const opacity = parseFloat(rangeEl.value);
      if (!key || isNaN(opacity)) return;
      try {
        await upsertOne({ materialKey: key, opacity });
        console.log('[mat-orch] persisted to sheet:', key);
      } catch (e) {
        console.warn('[mat-orch] persist error', e);
      }
    }
    rangeEl.addEventListener('change', commitOnce);
    rangeEl.addEventListener('blur', commitOnce);

    reflectFromSheet(selectEl, rangeEl);
  }

  async function wireOnce() {
    if (WIRED) return;

    const [selectEl, rangeEl] = await Promise.all([
      waitForElement(SELECTORS.materialSelect, 10000),
      waitForElement(SELECTORS.opacityRange, 10000),
    ]);

    if (!(selectEl && rangeEl)) {
      console.warn('[mat-orch] UI still not ready; aborting wire (no infinite retry).');
      return;
    }

    if (window.__LM_COMMIT_MODE) {
      await wireCommitMode(selectEl, rangeEl);
    } else {
      console.log('[mat-orch] commit-mode disabled; no handlers wired.');
    }
  }

  document.addEventListener('DOMContentLoaded', () => queueMicrotask(wireOnce));
  window.addEventListener('lm:scene-ready', () => queueMicrotask(wireOnce));
  window.addEventListener('lm:panel-material-ready', () => queueMicrotask(wireOnce));
  setTimeout(wireOnce, 500);
})();