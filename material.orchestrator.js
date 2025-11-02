/* 
 * material.orchestrator.js
 * V6_16g_SAFE_UI_PIPELINE (A-variant)
 *
 * 方針（寄せ方A）:
 * - Orchestrator 側を materialsSheetBridge の公開API（loadAll / upsertOne）に寄せる
 * - 保存は upsertOne() に一本化（内部で ensureSheet() が走る想定 / 自動作成は現状維持）
 * - 読み込みは loadAll() を取得して materialKey で絞り込み、”最新行 wins” を適用
 *
 * 期待UI要素（存在しない場合は待機＆間引きログで再試行）:
 * - #materialSelect (HTMLSelectElement)
 * - #opacityRange (HTMLInputElement[type=range], 0..1)
 * - #doubleSided (HTMLInputElement[type=checkbox])
 * - #unlitLike   (HTMLInputElement[type=checkbox])
 * - chroma系はあれば拾う: #chromaEnable, #chromaColor, #chromaTolerance, #chromaFeather
 *
 * 期待外部API:
 * - window.viewerBridge.listMaterials() -> [{ key, name }]|string[]|string
 * - window.viewerBridge.setMaterialOpacity(key, val)
 * - window.viewerBridge.setMaterialFlags?(key, { doubleSided, unlit })
 * - window.viewerBridge.setChromaKey?(key, { enable, color, tolerance, feather })
 * - window.materialsSheetBridge.loadAll(ctx) -> Promise<row[]>
 * - window.materialsSheetBridge.upsertOne(ctx, row) -> Promise<void>
 * - Sticky ctx: window.__lm_last_sheet_ctx  または  'lm:sheet-context' イベント(detail={spreadsheetId,sheetGid})
 */

(() => {
  const TAG = '[mat-orch]';
  const VER = 'V6_16g_SAFE_UI_PIPELINE.A';

  const state = {
    wired: false,
    lastListSig: '',
    ui: null,
    selectedKey: null,
    saveTimer: null,
    lastLog: new Map(), // key -> last timestamp
  };

  const logOnce = (k, msg) => {
    const now = performance.now();
    const last = state.lastLog.get(k) || 0;
    if (now - last > 2000) {
      console.log(`${TAG} ${msg}`);
      state.lastLog.set(k, now);
    }
  };

  const hardLog = (msg) => console.log(`${TAG} ${msg}`);

  // ---- wait helpers ----
  function waitForDOMContentLoaded() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return Promise.resolve();
    return new Promise(res => addEventListener('DOMContentLoaded', res, { once: true }));
  }

  function waitForUI(maxMs = 10000) {
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const tryPick = () => {
        const ui = pickUI();
        if (ui) {
          state.ui = ui;
          return res(ui);
        }
        if (performance.now() - t0 > maxMs) {
          return rej(new Error('UI elements not found (materialSelect/opacityRange)'));
        }
        logOnce('wait-ui', 'ui not ready yet, retry... UI elements not found (materialSelect/opacityRange)');
        setTimeout(tryPick, 600);
      };
      tryPick();
    });
  }

  function waitForViewer(maxMs = 15000) {
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const tick = () => {
        if (window.viewerBridge && typeof window.viewerBridge.listMaterials === 'function') {
          try {
            // a light probe
            window.viewerBridge.listMaterials();
            return res(window.viewerBridge);
          } catch (e) {/* ignore, not ready */}
        }
        if (performance.now() - t0 > maxMs) {
          return rej(new Error('viewerBridge not ready (listMaterials unavailable)'));
        }
        logOnce('wait-viewer', 'viewer not ready yet, retry...');
        setTimeout(tick, 700);
      };
      tick();
    });
  }

  function waitForSheetCtx(maxMs = 15000) {
    if (window.__lm_last_sheet_ctx) return Promise.resolve(window.__lm_last_sheet_ctx);
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const on = (e) => {
        const ctx = e.detail || null;
        if (ctx) {
          window.__lm_last_sheet_ctx = ctx; // sticky
          removeEventListener('lm:sheet-context', on);
          return res(ctx);
        }
      };
      addEventListener('lm:sheet-context', on);
      const tick = () => {
        if (window.__lm_last_sheet_ctx) {
          removeEventListener('lm:sheet-context', on);
          return res(window.__lm_last_sheet_ctx);
        }
        if (performance.now() - t0 > maxMs) {
          removeEventListener('lm:sheet-context', on);
          return rej(new Error('sheet-context not available'));
        }
        logOnce('wait-sheet', 'sheet-context not ready yet, retry...');
        setTimeout(tick, 800);
      };
      tick();
    });
  }

  // ---- UI picker ----
  function pickUI() {
    const materialSelect = document.querySelector('#materialSelect');
    const opacityRange   = document.querySelector('#opacityRange');
    const doubleSided    = document.querySelector('#doubleSided');
    const unlitLike      = document.querySelector('#unlitLike');
    // chroma (optional)
    const chromaEnable   = document.querySelector('#chromaEnable');
    const chromaColor    = document.querySelector('#chromaColor');
    const chromaTolerance= document.querySelector('#chromaTolerance');
    const chromaFeather  = document.querySelector('#chromaFeather');

    if (!materialSelect || !opacityRange) return null;
    return { materialSelect, opacityRange, doubleSided, unlitLike, chromaEnable, chromaColor, chromaTolerance, chromaFeather };
  }

  // ---- materials list helpers ----
  function normalizeMaterials(list) {
    // Accepts: [{key,name}] | string[] | string
    if (!list) return [];
    if (typeof list === 'string') return [{ key: list, name: String(list) }];
    if (Array.isArray(list)) {
      if (list.length && typeof list[0] === 'string') {
        return list.map(s => ({ key: String(s), name: String(s) }));
      }
      if (list.length && typeof list[0] === 'object') {
        return list.map(o => ({ key: String(o.key ?? o.name ?? ''), name: String(o.name ?? o.key ?? '') }))
                   .filter(m => m.key);
      }
    }
    return [];
  }

  function sigOf(list) {
    return JSON.stringify(list.map(m => m.key));
  }

  function fillMaterialSelect(list) {
    const ui = state.ui;
    const sel = ui.materialSelect;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '---';
    sel.appendChild(opt0);
    for (const m of list) {
      const opt = document.createElement('option');
      opt.value = m.key;
      opt.textContent = m.name || m.key;
      sel.appendChild(opt);
    }
  }

  // ---- sheet helpers (寄せ方A) ----
  async function loadLatestByKey(ctx, materialKey) {
    // materialsSheetBridge.loadAll(ctx) -> rows
    if (!window.materialsSheetBridge || typeof window.materialsSheetBridge.loadAll !== 'function') {
      hardLog('materialsSheetBridge.loadAll missing');
      return null;
    }
    const rows = await window.materialsSheetBridge.loadAll(ctx).catch(() => null);
    if (!rows || !rows.length) return null;
    const filtered = rows.filter(r => (r.materialKey ?? r.key) === materialKey);
    if (!filtered.length) return null;
    // 最新行 wins: updatedAt desc / ない場合は末尾
    filtered.sort((a,b) => {
      const ta = Date.parse(a.updatedAt || '') || 0;
      const tb = Date.parse(b.updatedAt || '') || 0;
      return tb - ta;
    });
    const latest = filtered[0];
    // 正規化
    return {
      materialKey,
      opacity: toNum(latest.opacity, 1),
      doubleSided: toBool(latest.doubleSided, false),
      unlit: toBool(latest.unlit, false),
      chromaEnable: toBool(latest.chromaEnable, false),
      chromaColor: latest.chromaColor || '#000000',
      chromaTolerance: toNum(latest.chromaTolerance, 0),
      chromaFeather: toNum(latest.chromaFeather, 0),
    };
  }

  function toNum(v, def=0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : def;
    }
  function toBool(v, def=false) {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1' || v === 1) return true;
    if (v === 'false' || v === '0' || v === 0) return false;
    return def;
  }

  async function saveDebounced(ctx, payload) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        if (!window.materialsSheetBridge || typeof window.materialsSheetBridge.upsertOne !== 'function') {
          hardLog('materialsSheetBridge.upsertOne missing');
          return;
        }
        const row = {
          materialKey: payload.materialKey,
          opacity: payload.opacity,
          doubleSided: payload.doubleSided,
          unlit: payload.unlit,
          chromaEnable: payload.chromaEnable,
          chromaColor: payload.chromaColor,
          chromaTolerance: payload.chromaTolerance,
          chromaFeather: payload.chromaFeather,
          updatedAt: new Date().toISOString(),
          updatedBy: (window.__lm_identity && window.__lm_identity.email) || 'unknown',
        };
        await window.materialsSheetBridge.upsertOne(ctx, row);
        logOnce('save-ok', `saved material "${row.materialKey}"`);
      } catch (e) {
        console.warn(`${TAG} save failed`, e);
      }
    }, 400);
  }

  // ---- UI <-> model ----
  function applyToUI(uivalues) {
    const ui = state.ui;
    if (ui.opacityRange && typeof uivalues.opacity === 'number') ui.opacityRange.value = String(uivalues.opacity);
    if (ui.doubleSided != null) ui.doubleSided.checked = !!uivalues.doubleSided;
    if (ui.unlitLike != null) ui.unlitLike.checked = !!uivalues.unlit;
    if (ui.chromaEnable != null) ui.chromaEnable.checked = !!uivalues.chromaEnable;
    if (ui.chromaColor  != null && uivalues.chromaColor) ui.chromaColor.value = String(uivalues.chromaColor);
    if (ui.chromaTolerance != null && Number.isFinite(uivalues.chromaTolerance)) ui.chromaTolerance.value = String(uivalues.chromaTolerance);
    if (ui.chromaFeather   != null && Number.isFinite(uivalues.chromaFeather)) ui.chromaFeather.value = String(uivalues.chromaFeather);
  }

  function collectFromUI() {
    const ui = state.ui;
    return {
      materialKey: state.selectedKey,
      opacity: Number(ui.opacityRange?.value ?? 1),
      doubleSided: !!ui.doubleSided?.checked,
      unlit: !!ui.unlitLike?.checked,
      chromaEnable: !!ui.chromaEnable?.checked,
      chromaColor: ui.chromaColor?.value || '#000000',
      chromaTolerance: Number(ui.chromaTolerance?.value ?? 0),
      chromaFeather: Number(ui.chromaFeather?.value ?? 0),
    };
  }

  function applyToModel(materialKey, vals) {
    if (!materialKey) return;
    try {
      if (typeof window.viewerBridge.setMaterialOpacity === 'function' && typeof vals.opacity === 'number') {
        window.viewerBridge.setMaterialOpacity(materialKey, vals.opacity);
      }
      if (typeof window.viewerBridge.setMaterialFlags === 'function') {
        window.viewerBridge.setMaterialFlags(materialKey, { doubleSided: !!vals.doubleSided, unlit: !!vals.unlit });
      }
      if (typeof window.viewerBridge.setChromaKey === 'function') {
        window.viewerBridge.setChromaKey(materialKey, {
          enable: !!vals.chromaEnable,
          color: vals.chromaColor || '#000000',
          tolerance: Number(vals.chromaTolerance || 0),
          feather: Number(vals.chromaFeather || 0),
        });
      }
    } catch (e) {
      console.warn(`${TAG} applyToModel error`, e);
    }
  }

  // ---- handlers ----
  async function onSelectChange(ctx) {
    const ui = state.ui;
    const key = ui.materialSelect.value || null;
    state.selectedKey = key;
    if (!key) return;
    // 保存値ロード → UI → モデル の順
    let vals = await loadLatestByKey(ctx, key);
    if (!vals) {
      // 初回: モデル現状値から拾えるなら拾う（なければデフォルト）
      vals = {
        materialKey: key,
        opacity: Number(ui.opacityRange?.value ?? 1),
        doubleSided: !!ui.doubleSided?.checked,
        unlit: !!ui.unlitLike?.checked,
        chromaEnable: !!ui.chromaEnable?.checked,
        chromaColor: ui.chromaColor?.value || '#000000',
        chromaTolerance: Number(ui.chromaTolerance?.value ?? 0),
        chromaFeather: Number(ui.chromaFeather?.value ?? 0),
      };
    }
    applyToUI(vals);
    applyToModel(key, vals);
  }

  function onUIChange(ctx) {
    // 即時プレビュー＋保存（デバウンス）
    const vals = collectFromUI();
    applyToModel(state.selectedKey, vals);
    saveDebounced(ctx, vals);
  }

  // ---- wireOnce ----
  function wireOnce(ctx, materials) {
    if (state.wired) return;
    const ui = state.ui;
    // build list once (guard by signature outside)
    fillMaterialSelect(materials);

    // events (one-time)
    ui.materialSelect.addEventListener('change', () => onSelectChange(ctx), { passive: true });
    if (ui.opacityRange) ui.opacityRange.addEventListener('input', () => onUIChange(ctx), { passive: true });
    if (ui.doubleSided)  ui.doubleSided.addEventListener('change', () => onUIChange(ctx), { passive: true });
    if (ui.unlitLike)    ui.unlitLike.addEventListener('change', () => onUIChange(ctx), { passive: true });
    if (ui.chromaEnable) ui.chromaEnable.addEventListener('change', () => onUIChange(ctx), { passive: true });
    if (ui.chromaColor)  ui.chromaColor.addEventListener('input',  () => onUIChange(ctx), { passive: true });
    if (ui.chromaTolerance) ui.chromaTolerance.addEventListener('input', () => onUIChange(ctx), { passive: true });
    if (ui.chromaFeather)   ui.chromaFeather.addEventListener('input',  () => onUIChange(ctx), { passive: true });

    state.wired = True;
    hardLog(`${VER} wireOnce complete`);
  }

  // ---- main boot ----
  (async function boot() {
    try {
      hardLog(`${VER} boot`);
      await waitForDOMContentLoaded();
      await waitForUI();
      const viewer = await waitForViewer();
      const ctx = await waitForSheetCtx();

      // materials probe
      const raw = viewer.listMaterials();
      const mats = normalizeMaterials(raw);
      const sig = sigOf(mats);
      if (sig && sig !== state.lastListSig) {
        state.lastListSig = sig;
        wireOnce(ctx, mats);
      } else if (!sig) {
        logOnce('empty-list', 'listMaterials returned empty; will retry');
        setTimeout(boot, 1200); // soft retry once
        return;
      }

    } catch (e) {
      console.warn(`${TAG} boot error`, e);
      // soft backoff retry
      setTimeout(boot, 1500);
    }
  })();

})();