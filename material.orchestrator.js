/*
 * material.orchestrator.js
 * V6_16g_SAFE_UI_PIPELINE.A2.2
 *
 * 追加: viewerBridge が per-material API を持たない場合に備え、
 *      起動時に "互換シム(shim)" を自動注入して描画反映を行う。
 * - setMaterialOpacity(key, val)     -> traverse Scene, material.name===key の opacity を更新
 * - setMaterialFlags(key, {doubleSided, unlit})
 * - setChromaKey(key, {enable,color,tolerance,feather})  (no-op placeholder; 将来対応)
 *
 * 既存の A2.1 の強化点は維持。
 */

(() => {
  const TAG = '[mat-orch]';
  const VER = 'V6_16g_SAFE_UI_PIPELINE.A2.2';

  const state = {
    ui: null,
    wired: false,
    haveList: false,
    lastListSig: '',
    selectedKey: null,
    saveTimer: null,
    ctx: null,
    viewerReady: false,
    lastLog: new Map(),
    mo: null,
    threeReady: false,
  };

  const hardLog = (msg, ...rest) => console.log(`${TAG} ${msg}`, ...rest);
  const warnLog = (msg, ...rest) => console.warn(`${TAG} ${msg}`, ...rest);
  const logOnce = (k, msg, minMs=2000) => {
    const now = performance.now();
    const last = state.lastLog.get(k) || 0;
    if (now - last > minMs) {
      console.log(`${TAG} ${msg}`);
      state.lastLog.set(k, now);
    }
  };
  const clamp01 = (n)=>{ n = Number(n); if (!Number.isFinite(n)) return 1; return Math.max(0, Math.min(1, n)); };

  // ---------- THREE scene helpers (shim) ----------
  function locateThreeScene() {
    const T = window.THREE;
    if (!T) return null;
    // パス候補
    const cand = [
      window.viewerBridge && window.viewerBridge.scene,
      window.viewerBridge && typeof window.viewerBridge.getScene === 'function' && window.viewerBridge.getScene(),
      window.viewerBridge && window.viewerBridge.viewer && window.viewerBridge.viewer.scene,
      window.__lm_scene,
      window.__LM_SCENE,
    ].filter(Boolean);
    for (const s of cand) {
      if (s && typeof s.traverse === 'function') return s;
    }
    // 最後の手段: グローバルから Scene を総当たり（重いので一度だけ）
    try {
      for (const k of Object.keys(window)) {
        const v = window[k];
        if (v && v.isScene && typeof v.traverse === 'function') return v;
      }
    } catch {}
    return null;
  }

  function ensureViewerShims() {
    if (!window.viewerBridge) return;
    // 既に実装があれば触らない
    const needOpacity = (typeof window.viewerBridge.setMaterialOpacity !== 'function') &&
                        (typeof window.viewerBridge.setOpacityForMaterial !== 'function') &&
                        (typeof window.viewerBridge.setMatOpacity !== 'function') &&
                        (typeof window.viewerBridge.setOpacity !== 'function');
    const needFlags   = (typeof window.viewerBridge.setMaterialFlags !== 'function') &&
                        (typeof window.viewerBridge.setFlagsForMaterial !== 'function') &&
                        (typeof window.viewerBridge.setMatFlags !== 'function') &&
                        (typeof window.viewerBridge.setFlags !== 'function');
    const needChroma  = (typeof window.viewerBridge.setChromaKey !== 'function');

    if (!(needOpacity || needFlags || needChroma)) return;

    const T = window.THREE;
    const scene = locateThreeScene();
    if (!T || !scene) { logOnce('shim-wait', 'THREE/scene not ready; deferred shim'); return; }

    // 実装: 名前一致で material を集めて反映
    function findMaterialsByName(name) {
      const mats = new Set();
      scene.traverse(obj => {
        const mat = obj && obj.material;
        if (!mat) return;
        if (Array.isArray(mat)) {
          for (const m of mat) if (m && m.name === name) mats.add(m);
        } else {
          if (mat.name === name) mats.add(mat);
        }
      });
      return Array.from(mats);
    }

    function applyOpacityByName(name, value) {
      const v = clamp01(value);
      const mats = findMaterialsByName(name);
      if (!mats.length) { logOnce('no-mat', `material "${name}" not found`); return false; }
      for (const m of mats) {
        m.transparent = true;
        if ('opacity' in m) m.opacity = v;
        m.needsUpdate = true;
      }
      hardLog(`shim opacity ${name} -> ${v} (x${mats.length})`);
      return true;
    }

    function applyFlagsByName(name, flags) {
      const mats = findMaterialsByName(name);
      if (!mats.length) { logOnce('no-mat', `material "${name}" not found`); return false; }
      for (const m of mats) {
        if (flags && 'doubleSided' in flags && window.THREE) {
          m.side = flags.doubleSided ? window.THREE.DoubleSide : window.THREE.FrontSide;
        }
        if (flags && 'unlit' in flags) {
          // 近似: ライティングの影響を軽減
          m.lights = !flags.unlit;
          // トーンマッピングの影響を切る
          if ('toneMapped' in m) m.toneMapped = !flags.unlit;
          m.needsUpdate = true;
        }
      }
      hardLog(`shim flags ${name} ->`, flags);
      return true;
    }

    // シム注入
    if (needOpacity) {
      window.viewerBridge.setMaterialOpacity = (key, val) => applyOpacityByName(String(key), val);
    }
    if (needFlags) {
      window.viewerBridge.setMaterialFlags = (key, payload) => applyFlagsByName(String(key), payload || {});
    }
    if (needChroma) {
      window.viewerBridge.setChromaKey = (key, payload) => {
        // ここでは no-op（将来必要なら Shader/alphaTest 等を適用）
        hardLog('shim chromaKey (placeholder)', key, payload);
        return true;
      };
    }
    hardLog('viewer shims installed');
  }

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
          ensureViewerShims(); // ビューアが生えたらシム試行
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
    let perMatPanel = findPanelByHeadingText('per-material opacity');
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

    let shadingPanel = findPanelByHeadingText('shading');
    const doubleSided = shadingPanel ? shadingPanel.querySelector('input[type="checkbox"]') : null;
    let unlitLike = null;
    if (shadingPanel) {
      const boxes = shadingPanel.querySelectorAll('input[type="checkbox"]');
      if (boxes && boxes.length >= 2) unlitLike = boxes[1];
    }

    let chromaPanel = findPanelByHeadingText('chroma key');
    const chromaEnable    = chromaPanel ? chromaPanel.querySelector('input[type="checkbox"]') : null;
    const chromaTolerance = chromaPanel ? chromaPanel.querySelector('input[type="range"]') : null;
    let chromaFeather = null;
    if (chromaPanel) {
      const ranges = chromaPanel.querySelectorAll('input[type="range"]');
      if (ranges && ranges.length >= 2) chromaFeather = ranges[1];
    }
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
  const sigOf = (list) => JSON.stringify(list.map(m => m.key));
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
        ensureViewerShims(); // viewer/THREE が後から用意されてもOK
        const raw = window.viewerBridge.listMaterials && window.viewerBridge.listMaterials();
        const mats = normalizeMaterials(raw);
        const sig  = sigOf(mats);
        if (mats.length === 0) { logOnce('empty-list', 'listMaterials is empty; will retry'); return; }
        if (sig !== state.lastListSig) {
          state.lastListSig = sig;
          fillMaterialSelect(mats);
          maybeWire();
          hardLog(`${VER} materials listed (${mats.length})`);
        }
      } catch (e) { logOnce('refresh-err', 'materials refresh failed; will retry'); }
    };
    refresh();
    addEventListener('lm:scene-ready', () => {
      hardLog('EVENT lm:scene-ready');
      setTimeout(refresh, 100);
      setTimeout(refresh, 500);
      setTimeout(refresh, 1200);
    });
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
        opacity: clamp01(latest.opacity),
        doubleSided: toBool(latest.doubleSided, false),
        unlit: toBool(latest.unlit, false),
        chromaEnable: toBool(latest.chromaEnable, false),
        chromaColor: latest.chromaColor || '#000000',
        chromaTolerance: Number.isFinite(Number(latest.chromaTolerance)) ? Number(latest.chromaTolerance) : 0,
        chromaFeather: Number.isFinite(Number(latest.chromaFeather)) ? Number(latest.chromaFeather) : 0,
      };
    } catch { return null; }
  }
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
        if (!ctx || !ctx.spreadsheetId) { logOnce('skip-save', 'ctx missing; skip save'); return; }
        const row = {
          materialKey: payload.materialKey,
          opacity: clamp01(payload.opacity),
          doubleSided: !!payload.doubleSided,
          unlit: !!payload.unlit,
          chromaEnable: !!payload.chromaEnable,
          chromaColor: payload.chromaColor || '#000000',
          chromaTolerance: Number(payload.chromaTolerance || 0),
          chromaFeather: Number(payload.chromaFeather || 0),
          updatedAt: new Date().toISOString(),
          updatedBy: (window.__lm_identity && window.__lm_identity.email) || 'unknown',
        };
        await api.upsertOne(ctx, row);
        logOnce('save-ok', `saved ${row.materialKey}`);
      } catch (e) {
        warnLog('save failed', e);
      }
    }, 400);
  }

  // --------- UI <-> Model ---------
  function applyToUI(vals) {
    const ui = state.ui;
    if (!ui) return;
    if (ui.opacityRange) ui.opacityRange.value = String(clamp01(vals.opacity));
    if (ui.doubleSided != null) ui.doubleSided.checked = !!vals.doubleSided;
    if (ui.unlitLike   != null) ui.unlitLike.checked   = !!vals.unlit;
    if (ui.chromaEnable!= null) ui.chromaEnable.checked= !!vals.chromaEnable;
    if (ui.chromaColor && vals.chromaColor) ui.chromaColor.value = String(vals.chromaColor);
    if (ui.chromaTolerance && Number.isFinite(vals.chromaTolerance)) ui.chromaTolerance.value = String(vals.chromaTolerance);
    if (ui.chromaFeather   && Number.isFinite(vals.chromaFeather))   ui.chromaFeather.value   = String(vals.chromaFeather);
  }

  function tryCall(fn, ...args) {
    try { return fn && fn(...args); } catch(e) { warnLog('viewer call failed', e); }
  }

  function applyToModel(key, vals) {
    if (!key || !window.viewerBridge) { logOnce('no-key', 'no selected material; skip apply'); return; }
    const vb = window.viewerBridge;
    const opacity = clamp01(vals.opacity);

    const fOpacity = vb.setMaterialOpacity || vb.setOpacityForMaterial || vb.setMatOpacity || vb.setOpacity;
    const fFlags   = vb.setMaterialFlags   || vb.setFlagsForMaterial   || vb.setMatFlags   || vb.setFlags;
    const fChroma  = vb.setChromaKey       || vb.setChromaForMaterial  || vb.setMatChroma  || null;

    hardLog(`apply model key=${key} opacity=${opacity} ds=${!!vals.doubleSided} unlit=${!!vals.unlit}`);

    let used = false;
    if (typeof fOpacity === 'function') { tryCall(fOpacity, key, opacity); used = true; }
    if (typeof fFlags === 'function')   { tryCall(fFlags, key, { doubleSided: !!vals.doubleSided, unlit: !!vals.unlit }); used = true; }
    if (typeof fChroma === 'function')  { tryCall(fChroma, key, {
      enable: !!vals.chromaEnable,
      color: vals.chromaColor || '#000000',
      tolerance: Number(vals.chromaTolerance || 0),
      feather: Number(vals.chromaFeather || 0),
    }); used = true; }

    if (!used) {
      // フォールバック: shim を試す（未インストールならここで試行）
      ensureViewerShims();
      if (typeof window.viewerBridge.setMaterialOpacity === 'function') {
        tryCall(window.viewerBridge.setMaterialOpacity, key, opacity);
        used = true;
      }
      if (typeof window.viewerBridge.setMaterialFlags === 'function') {
        tryCall(window.viewerBridge.setMaterialFlags, key, { doubleSided: !!vals.doubleSided, unlit: !!vals.unlit });
        used = true;
      }
      if (!used) warnLog('no per-material opacity API (even after shim)');
    }
  }

  async function onSelectChange() {
    const ui = state.ui;
    if (!ui) return;
    const key = ui.materialSelect.value || null;
    state.selectedKey = key;
    if (!key) { logOnce('no-key', 'no material selected'); return; }

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

  function collectFromUI() {
    const ui = state.ui;
    return {
      opacity: clamp01(ui.opacityRange ? ui.opacityRange.value : 1),
      doubleSided: !!ui.doubleSided?.checked,
      unlit: !!ui.unlitLike?.checked,
      chromaEnable: !!ui.chromaEnable?.checked,
      chromaColor: ui.chromaColor?.value || '#000000',
      chromaTolerance: Number(ui.chromaTolerance?.value ?? 0),
      chromaFeather: Number(ui.chromaFeather?.value ?? 0),
    };
  }

  function onUIChange() {
    if (!state.selectedKey) { logOnce('no-key', 'UI changed but no material selected'); return; }
    const vals = {
      materialKey: state.selectedKey,
      ...collectFromUI()
    };
    applyToModel(state.selectedKey, vals);
    if (state.ctx && state.ctx.spreadsheetId) saveDebounced(state.ctx, vals);
    else logOnce('skip-save', 'ctx not ready; skip save');
  }

  // --------- wiring ---------
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
  function maybeWire() { if (state.ui && state.haveList && !state.wired) wireOnce(); }

  // --------- boot ---------
  (async function boot() {
    try {
      hardLog(`${VER} boot`);
      await onDOMContentLoaded();
      ensureUIObserved();
      await waitForViewer();
      waitForSheetCtx().then(() => hardLog('sheet ctx ready')).catch(()=>{});
      startMaterialsRefreshLoop();
    } catch (e) {
      warnLog('boot error', e);
      setTimeout(boot, 1200);
    }
  })();

})();