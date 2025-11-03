/*
 * material.orchestrator.js
 * V6_16g_SAFE_UI_PIPELINE.A2.3
 *
 * 変更点:
 * - THREE/scene の探索強化（viewerBridge.root / model / gltf.scene / viewer.scene / meshes[] 等）
 * - scene が見つからない場合でも、viewerBridge.meshes / objects / children 配列を総当たりして
 *   material.name による反映を行うフォールバックを追加
 * - デバッグ用ダンプ関数 __LM_DEBUG_DUMP を追加
 */

(() => {
  const TAG = '[mat-orch]';
  const VER = 'V6_16g_SAFE_UI_PIPELINE.A2.3';

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
  const toBool = (v, d=false) => (v===true||v==='true'||v===1||v==='1') ? true : (v===false||v==='false'||v===0||v==='0'?false:d);

  // ---------- Debug helper ----------
  window.__LM_DEBUG_DUMP = () => {
    const vb = window.viewerBridge || {};
    const keys = Object.keys(vb);
    const cand = [
      vb.scene, vb.getScene && vb.getScene(), vb.viewer && vb.viewer.scene,
      vb.root, vb.model, vb.gltf && vb.gltf.scene, vb.sceneRoot,
      vb.three && (vb.three.scene||vb.three.root),
      window.__lm_scene, window.__LM_SCENE
    ].filter(Boolean);
    return { vbKeys: keys, candidates: cand.map((x,i)=>({i, hasTraverse: !!(x&&x.traverse), type: (x && x.type)||typeof x })), THREE: !!window.THREE };
  };

  // ---------- THREE scene helpers (shim) ----------
  function locateThreeScene() {
    const T = window.THREE;
    if (!T) return null;
    const vb = window.viewerBridge || {};
    const cand = [
      vb.scene,
      typeof vb.getScene === 'function' && vb.getScene(),
      vb.viewer && vb.viewer.scene,
      vb.root,
      vb.model,
      vb.gltf && vb.gltf.scene,
      vb.sceneRoot,
      vb.three && (vb.three.scene || vb.three.root),
      window.__lm_scene,
      window.__LM_SCENE,
    ].filter(Boolean);
    for (const s of cand) {
      if (s && typeof s.traverse === 'function') return s;
    }
    // 最後の手段: window.* を軽くスキャン
    try {
      for (const k of Object.keys(window)) {
        const v = window[k];
        if (v && v.isScene && typeof v.traverse === 'function') return v;
      }
    } catch {}
    return null;
  }

  // 配列ベースの総当たり（scene がなくても使える）
  function foreachCandidates(cb) {
    const vb = window.viewerBridge || {};
    const pools = [];
    if (vb.meshes && Array.isArray(vb.meshes)) pools.push(vb.meshes);
    if (vb.objects && Array.isArray(vb.objects)) pools.push(vb.objects);
    if (vb.children && Array.isArray(vb.children)) pools.push(vb.children);
    if (vb.viewer && vb.viewer.children && Array.isArray(vb.viewer.children)) pools.push(vb.viewer.children);
    let hit = 0;
    for (const arr of pools) {
      for (const obj of arr) {
        try { cb(obj); hit++; } catch {}
      }
    }
    return hit;
  }

  function ensureViewerShims() {
    if (!window.viewerBridge) return;
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
    // シーンがなくても、配列フォールバックで動作可能にする
    const hasAnyPool = !!foreachCandidates(()=>{});

    if (!T && !scene && !hasAnyPool) { logOnce('shim-wait', 'THREE/scene not ready; deferred shim'); return; }

    function touchMaterial(m, fn) {
      if (!m) return;
      if (Array.isArray(m)) { for (const x of m) fn(x); }
      else fn(m);
    }

    function visitAllMaterials(visitor) {
      let count = 0;
      if (scene) {
        scene.traverse(obj => {
          touchMaterial(obj && obj.material, m => { visitor(m, obj); count++; });
        });
      }
      // 追加プールを総当たり
      foreachCandidates(obj => touchMaterial(obj && obj.material, m => { visitor(m, obj); count++; }));
      return count;
    }

    function applyOpacityByName(name, value) {
      const v = clamp01(value);
      let applied = 0;
      visitAllMaterials((m) => {
        if (!m || m.name !== name) return;
        m.transparent = true;
        if ('opacity' in m) m.opacity = v;
        m.needsUpdate = true;
        applied++;
      });
      if (applied) hardLog(`shim opacity ${name} -> ${v} (x${applied})`);
      else logOnce('no-mat', `material "${name}" not found`);
      return applied>0;
    }

    function applyFlagsByName(name, flags) {
      let applied = 0;
      visitAllMaterials((m) => {
        if (!m || m.name !== name) return;
        if (flags && 'doubleSided' in flags && window.THREE) {
          m.side = flags.doubleSided ? window.THREE.DoubleSide : window.THREE.FrontSide;
        }
        if (flags && 'unlit' in flags) {
          m.lights = !flags.unlit;
          if ('toneMapped' in m) m.toneMapped = !flags.unlit;
        }
        m.needsUpdate = true;
        applied++;
      });
      if (applied) hardLog(`shim flags ${name} ->`, flags, `(x${applied})`);
      else logOnce('no-mat', `material "${name}" not found`);
      return applied>0;
    }

    if (needOpacity) window.viewerBridge.setMaterialOpacity = (key, val) => applyOpacityByName(String(key), val);
    if (needFlags)   window.viewerBridge.setMaterialFlags   = (key, payload) => applyFlagsByName(String(key), payload||{});
    if (needChroma)  window.viewerBridge.setChromaKey       = (key, payload) => { hardLog('shim chromaKey (placeholder)', key, payload); return true; };

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
          ensureViewerShims();
          return res(window.viewerBridge);
        }
        if (performance.now() - t0 > maxMs) return rej(new Error('viewerBridge not ready'));
        logOnce('wait-viewer', 'viewer not ready yet, retry...');
        setTimeout(tick, 600);
      };
      tick();
    });
  }
  function waitForSheetCtx(maxMs = 20000) {
    if (window.__lm_last_sheet_ctx) { state.ctx = window.__lm_last_sheet_ctx; return Promise.resolve(state.ctx); }
    const t0 = performance.now();
    return new Promise((res, rej) => {
      const on = (e) => {
        const ctx = e.detail || null;
        if (ctx) { window.__lm_last_sheet_ctx = ctx; state.ctx = ctx; removeEventListener('lm:sheet-context', on); return res(ctx); }
      };
      addEventListener('lm:sheet-context', on);
      const tick = () => {
        if (window.__lm_last_sheet_ctx) { removeEventListener('lm:sheet-context', on); state.ctx = window.__lm_last_sheet_ctx; return res(state.ctx); }
        if (performance.now() - t0 > maxMs) { removeEventListener('lm:sheet-context', on); return rej(new Error('sheet-context not available')); }
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
      const opt = Array.from(document.querySelectorAll('select')).find(s => (s.textContent || '').toLowerCase().includes('select material'));
      if (opt) perMatPanel = opt.closest('section,div,fieldset,article') || document.body;
    }
    const materialSelect = perMatPanel ? perMatPanel.querySelector('select') : null;
    const opacityRange = (perMatPanel ? perMatPanel.querySelector('input[type="range"]') : null) || document.querySelector('input[type="range"]');

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
      if (ui) { state.ui = ui; hardLog(`${VER} ui discovered`); maybeWire(); return true; }
      return false;
    };
    if (tryPick()) return;
    if (state.mo) return;
    state.mo = new MutationObserver(() => {
      if (tryPick()) { state.mo.disconnect(); state.mo = null; }
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
        ensureViewerShims();
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
      setTimeout(()=>ensureViewerShims(), 50);
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
      filtered.sort((a,b) => (Date.parse(b.updatedAt||'0') - Date.parse(a.updatedAt||'0')));
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

  function tryCall(fn, ...args) { try { return fn && fn(...args); } catch(e) { warnLog('viewer call failed', e); } }

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
    if (typeof fChroma === 'function')  { tryCall(fChroma, key, { enable: !!vals.chromaEnable, color: vals.chromaColor||'#000000', tolerance: Number(vals.chromaTolerance||0), feather: Number(vals.chromaFeather||0), }); used = true; }

    if (!used) {
      // フォールバック: shim（scene / arrays）
      ensureViewerShims();
      const f1 = window.viewerBridge.setMaterialOpacity;
      const f2 = window.viewerBridge.setMaterialFlags;
      if (typeof f1 === 'function') { tryCall(f1, key, opacity); used = true; }
      if (typeof f2 === 'function') { tryCall(f2, key, { doubleSided: !!vals.doubleSided, unlit: !!vals.unlit }); used = true; }
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
    const vals = { materialKey: state.selectedKey, ...collectFromUI() };
    applyToModel(state.selectedKey, vals);
    if (state.ctx && state.ctx.spreadsheetId) saveDebounced(state.ctx, vals);
    else logOnce('skip-save', 'ctx not ready; skip save');
  }

  // --------- Saving ---------
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
      } catch (e) { warnLog('save failed', e); }
    }, 400);
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