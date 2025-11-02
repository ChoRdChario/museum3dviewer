/*
 * material.orchestrator.js
 * V6_16g_SAFE_UI_PIPELINE.A2
 *
 * 目的：UI未生成やscene未安定でも失敗せず、後追いで「UI配線」「マテリアル検出」を完了させる。
 * 寄せ方A：materialsSheetBridge.loadAll / upsertOne に合わせる。
 *
 * 主な変更:
 * - UI要素の特定を「固定ID依存」から「パネル見出しのテキスト探索 + フォールバック」に切替
 * - UI未準備でも boot を落とさず、MutationObserver で監視し続ける
 * - マテリアルリストは viewerBridge.listMaterials() が非空になった時点で投入（scene-ready待ち + ポーリング）
 * - 保存は upsertOne() に一本化、読み込みは loadAll() → materialKey で絞って最新行 wins
 */

(() => {
  const TAG = '[mat-orch]';
  const VER = 'V6_16g_SAFE_UI_PIPELINE.A2';

  const state = {
    ui: null,
    wired: false,
    haveList: false,
    lastListSig: '',
    selectedKey: null,
    saveTimer: null,
    ctx: null,
    viewerReady: false,
    lastLog: new Map(), // key -> last timestamp
    mo: null, // MutationObserver
  };

  const hardLog = (msg) => console.log(`${TAG} ${msg}`);
  const logOnce = (k, msg, minMs=2000) => {
    const now = performance.now();
    const last = state.lastLog.get(k) || 0;
    if (now - last > minMs) {
      console.log(`${TAG} ${msg}`);
      state.lastLog.set(k, now);
    }
  };

  // --------- Wait helpers ---------
  function onDOMContentLoaded() {
    if (document.readyState === 'complete' || document.readyState === 'interactive') return Promise.resolve();
    return new Promise(res => addEventListener('DOMContentLoaded', res, { once: true }));
  }

  function waitForViewer(maxMs = 20000) {
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const tick = () => {
        if (window.viewerBridge && typeof window.viewerBridge.listMaterials === 'function') {
          state.viewerReady = true;
          return res(window.viewerBridge);
        }
        if (performance.now() - t0 > maxMs) {
          return rej(new Error('viewerBridge not ready'));
        }
        logOnce('wait-viewer', 'viewer not ready yet, retry...');
        setTimeout(tick, 600);
      };
      tick();
    });
  }

  function waitForSheetCtx(maxMs = 20000) {
    if (window.__lm_last_sheet_ctx) {
      state.ctx = window.__lm_last_sheet_ctx;
      return Promise.resolve(state.ctx);
    }
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const on = (e) => {
        const ctx = e.detail || null;
        if (ctx) {
          window.__lm_last_sheet_ctx = ctx;
          state.ctx = ctx;
          removeEventListener('lm:sheet-context', on);
          return res(ctx);
        }
      };
      addEventListener('lm:sheet-context', on);
      const tick = () => {
        if (window.__lm_last_sheet_ctx) {
          removeEventListener('lm:sheet-context', on);
          state.ctx = window.__lm_last_sheet_ctx;
          return res(state.ctx);
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

  // --------- UI discovery ---------
  function findPanelByHeadingText(keyword) {
    keyword = keyword.toLowerCase();
    const candidates = Array.from(document.querySelectorAll('section,div,fieldset,article'));
    for (const el of candidates) {
      const txt = (el.textContent || '').toLowerCase();
      if (!txt) continue;
      if (txt.includes(keyword)) return el;
    }
    return null;
  }

  function pickUI() {
    // 1) Per-material opacity パネル（必須：select + input[type=range]）
    let perMatPanel = findPanelByHeadingText('per-material opacity');
    // フォールバック: ラベルに "Select material" が含まれる近傍を探す
    if (!perMatPanel) {
      const opt = Array.from(document.querySelectorAll('select')).find(s => {
        return (s.textContent || '').toLowerCase().includes('select material');
      });
      if (opt) perMatPanel = opt.closest('section,div,fieldset,article') || document.body;
    }
    const materialSelect = perMatPanel ? perMatPanel.querySelector('select') : null;
    const opacityRange =
      (perMatPanel ? perMatPanel.querySelector('input[type="range"]') : null) ||
      document.querySelector('input[type="range"]');

    // 2) Shading パネル（任意）
    let shadingPanel = findPanelByHeadingText('shading');
    const doubleSided = shadingPanel ? shadingPanel.querySelector('input[type="checkbox"]') : null;
    // "Unlit-like" は同パネル内2つ目のチェックを想定
    let unlitLike = null;
    if (shadingPanel) {
      const boxes = shadingPanel.querySelectorAll('input[type="checkbox"]');
      if (boxes && boxes.length >= 2) unlitLike = boxes[1];
    }

    // 3) Chroma key パネル（任意）
    let chromaPanel = findPanelByHeadingText('chroma key');
    const chromaEnable    = chromaPanel ? chromaPanel.querySelector('input[type="checkbox"]') : null;
    const chromaTolerance = chromaPanel ? chromaPanel.querySelector('input[type="range"]') : null;
    let chromaFeather = null;
    if (chromaPanel) {
      const ranges = chromaPanel.querySelectorAll('input[type="range"]');
      if (ranges && ranges.length >= 2) chromaFeather = ranges[1];
    }
    // chromaColor は将来（カラーピッカー）が入る想定。現状は省略可。
    const chromaColor = chromaPanel ? chromaPanel.querySelector('input[type="color"]') : null;

    if (!materialSelect || !opacityRange) return null;
    return { materialSelect, opacityRange, doubleSided, unlitLike, chromaEnable, chromaColor, chromaTolerance, chromaFeather };
  }

  function ensureUIObserved() {
    if (state.ui) return;
    const tryPick = () => {
      const ui = pickUI();
      if (ui) {
        state.ui = ui;
        hardLog(`${VER} ui discovered`);
        maybeWire();
        return true;
      }
      return false;
    };
    if (tryPick()) return;
    // Observerで後追い
    if (state.mo) return;
    state.mo = new MutationObserver(() => {
      if (tryPick()) {
        state.mo.disconnect();
        state.mo = null;
      }
    });
    state.mo.observe(document.body, { childList: true, subtree: true });
    logOnce('wait-ui', 'ui not ready; observing...');
  }

  // --------- Materials discovery ---------
  function normalizeMaterials(list) {
    if (!list) return [];
    if (typeof list === 'string') return [{ key: String(list), name: String(list) }];
    if (Array.isArray(list)) {
      if (!list.length) return [];
      if (typeof list[0] === 'string') return list.map(s => ({ key: String(s), name: String(s) }));
      if (typeof list[0] === 'object') {
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
    if (!state.ui) return;
    const sel = state.ui.materialSelect;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select material —';
    sel.appendChild(opt0);
    for (const m of list) {
      const opt = document.createElement('option');
      opt.value = m.key;
      opt.textContent = m.name || m.key;
      sel.appendChild(opt);
    }
    state.haveList = true;
  }

  function startMaterialsRefreshLoop() {
    const refresh = () => {
      try {
        if (!state.viewerReady || !window.viewerBridge) return;
        const raw = window.viewerBridge.listMaterials && window.viewerBridge.listMaterials();
        const mats = normalizeMaterials(raw);
        const sig  = sigOf(mats);
        if (mats.length === 0) {
          logOnce('empty-list', 'listMaterials is empty; will retry');
          return;
        }
        if (sig !== state.lastListSig) {
          state.lastListSig = sig;
          fillMaterialSelect(mats);
          maybeWire(); // UIが後勝ちでもOK
          hardLog(`${VER} materials listed (${mats.length})`);
        }
      } catch (e) {
        logOnce('refresh-err', 'materials refresh failed; will retry');
      }
    };
    refresh();
    // scene-ready を拾って即再試行
    addEventListener('lm:scene-ready', () => {
      hardLog('EVENT lm:scene-ready');
      setTimeout(refresh, 100);
      setTimeout(refresh, 500);
      setTimeout(refresh, 1200);
    });
    // ポーリング（軽め）
    setInterval(refresh, 1200);
  }

  // --------- Sheet helpers (寄せ方A) ---------
  async function loadLatestByKey(ctx, materialKey) {
    try {
      const api = window.materialsSheetBridge;
      if (!api || typeof api.loadAll !== 'function') return null;
      const rows = await api.loadAll(ctx).catch(() => null);
      if (!rows || !rows.length) return null;
      const filtered = rows.filter(r => (r.materialKey ?? r.key) === materialKey);
      if (!filtered.length) return null;
      filtered.sort((a,b) => {
        const ta = Date.parse(a.updatedAt || '') || 0;
        const tb = Date.parse(b.updatedAt || '') || 0;
        return tb - ta;
      });
      const latest = filtered[0];
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
    } catch { return null; }
  }
  const toNum = (v, d=0)=> (Number.isFinite(Number(v)) ? Number(v) : d);
  function toBool(v, d=false) {
    if (typeof v === 'boolean') return v;
    if (v === 'true' || v === '1' || v === 1) return true;
    if (v === 'false' || v === '0' || v === 0) return false;
    return d;
  }
  async function saveDebounced(ctx, payload) {
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(async () => {
      try {
        const api = window.materialsSheetBridge;
        if (!api || typeof api.upsertOne !== 'function') return;
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
        await api.upsertOne(ctx, row);
        logOnce('save-ok', `saved ${row.materialKey}`);
      } catch (e) {
        console.warn(`${TAG} save failed`, e);
      }
    }, 400);
  }

  // --------- UI <-> Model ---------
  function applyToUI(vals) {
    const ui = state.ui;
    if (!ui) return;
    if (ui.opacityRange && Number.isFinite(vals.opacity)) ui.opacityRange.value = String(vals.opacity);
    if (ui.doubleSided != null) ui.doubleSided.checked = !!vals.doubleSided;
    if (ui.unlitLike   != null) ui.unlitLike.checked   = !!vals.unlit;
    if (ui.chromaEnable!= null) ui.chromaEnable.checked= !!vals.chromaEnable;
    if (ui.chromaColor && vals.chromaColor) ui.chromaColor.value = String(vals.chromaColor);
    if (ui.chromaTolerance && Number.isFinite(vals.chromaTolerance)) ui.chromaTolerance.value = String(vals.chromaTolerance);
    if (ui.chromaFeather   && Number.isFinite(vals.chromaFeather))   ui.chromaFeather.value   = String(vals.chromaFeather);
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
  function applyToModel(key, vals) {
    if (!key || !window.viewerBridge) return;
    try {
      if (typeof window.viewerBridge.setMaterialOpacity === 'function' && Number.isFinite(vals.opacity)) {
        window.viewerBridge.setMaterialOpacity(key, vals.opacity);
      }
      if (typeof window.viewerBridge.setMaterialFlags === 'function') {
        window.viewerBridge.setMaterialFlags(key, { doubleSided: !!vals.doubleSided, unlit: !!vals.unlit });
      }
      if (typeof window.viewerBridge.setChromaKey === 'function') {
        window.viewerBridge.setChromaKey(key, {
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

  async function onSelectChange() {
    const ui = state.ui;
    if (!ui) return;
    const key = ui.materialSelect.value || null;
    state.selectedKey = key;
    if (!key) return;
    // 保存値 → UI → モデル
    const vals = (state.ctx && await loadLatestByKey(state.ctx, key)) || {
      materialKey: key,
      opacity: Number(ui.opacityRange?.value ?? 1),
      doubleSided: !!ui.doubleSided?.checked,
      unlit: !!ui.unlitLike?.checked,
      chromaEnable: !!ui.chromaEnable?.checked,
      chromaColor: ui.chromaColor?.value || '#000000',
      chromaTolerance: Number(ui.chromaTolerance?.value ?? 0),
      chromaFeather: Number(ui.chromaFeather?.value ?? 0),
    };
    applyToUI(vals);
    applyToModel(key, vals);
  }
  function onUIChange() {
    const vals = collectFromUI();
    applyToModel(state.selectedKey, vals);
    if (state.ctx) saveDebounced(state.ctx, vals);
  }

  function wireOnce() {
    if (state.wired || !state.ui) return;
    const ui = state.ui;
    ui.materialSelect.addEventListener('change', onSelectChange, { passive: true });
    if (ui.opacityRange) ui.opacityRange.addEventListener('input', onUIChange, { passive: true });
    if (ui.doubleSided)  ui.doubleSided.addEventListener('change', onUIChange, { passive: true });
    if (ui.unlitLike)    ui.unlitLike.addEventListener('change', onUIChange, { passive: true });
    if (ui.chromaEnable) ui.chromaEnable.addEventListener('change', onUIChange, { passive: true });
    if (ui.chromaColor)  ui.chromaColor.addEventListener('input',  onUIChange, { passive: true });
    if (ui.chromaTolerance) ui.chromaTolerance.addEventListener('input', onUIChange, { passive: true });
    if (ui.chromaFeather)   ui.chromaFeather.addEventListener('input', onUIChange, { passive: true });
    state.wired = true;
    hardLog(`${VER} wireOnce complete`);
  }

  function maybeWire() {
    if (!state.ui) return;
    if (state.haveList && !state.wired) {
      wireOnce();
    }
  }

  // --------- boot ---------
  (async function boot() {
    try {
      hardLog(`${VER} boot`);
      await onDOMContentLoaded();
      ensureUIObserved();                 // UIは後追いでOK
      await waitForViewer();              // viewerBridgeが生えるまで
      waitForSheetCtx().catch(()=>{});    // ctxは遅れても良い（初回保存時までに間に合えばOK）
      startMaterialsRefreshLoop();        // 非空になったら投入
    } catch (e) {
      console.warn(`${TAG} boot error`, e);
      setTimeout(boot, 1200);
    }
  })();

})();