// material.orchestrator.js
// Robust, order-safe orchestrator for Material pane.

(() => {
  const VERSION_TAG = 'V6_16b_ORDER_SAFE_UI_SYNC';
  console.log('[mat-orch] loaded VERSION_TAG:', VERSION_TAG);

  // ======== tiny utils ========
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 「false」のタイポ注意（ReferenceError対策）
  const throttle = (fn, wait) => {
    let last = 0, timer = null, lastArgs = null;
    return (...args) => {
      const now = Date.now();
      const remain = wait - (now - last);
      lastArgs = args;
      if (remain <= 0) {
        last = now;
        fn(...lastArgs);
        lastArgs = null;
      } else if (timer === null) {
        timer = setTimeout(() => {
          last = Date.now();
          fn(...(lastArgs || []));
          lastArgs = null;
          timer = null;
        }, remain);
      }
    };
  };

  function waitForEventOnce(type, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      let to = null;
      const handler = (ev) => {
        clearTimeout(to);
        window.removeEventListener(type, handler, { capture: false });
        resolve(ev.detail || ev);
      };
      window.addEventListener(type, handler, { once: true });
      to = setTimeout(() => {
        window.removeEventListener(type, handler, { capture: false });
        reject(new Error(`waitForEventOnce timeout: ${type}`));
      }, timeoutMs);
    });
  }

  function qs(id) { return document.getElementById(id); }

  // ======== UI refs ========
  const ui = {
    selectModel: qs('pm-model') || qs('pm-model-select'), // 互換
    selectMaterial: qs('pm-material'),
    rangeOpacity: qs('pm-opacity-range'),
    outOpacity: qs('pm-opacity-val'),
    chkDouble: qs('pm-flag-doublesided'),
    chkUnlit: qs('pm-flag-unlit'),
    chkChromaEnable: qs('pm-ck-enable'),
    rangeChromaTol: qs('pm-ck-tol'),
    rangeChromaFeather: qs('pm-ck-feather'),
  };

  function assertUI() {
    const missing = Object.entries(ui).filter(([k, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error('UI controls not found: ' + missing.join(', '));
  }

  // ======== State ========
  let suspendEvents = false;
  let latestByKey = new Map(); // materialKey -> saved row
  let stableMaterials = [];     // [{key, name, ref}...]

  // ======== Viewer Helpers ========
  function getViewer() {
    if (!window.viewerBridge || typeof window.viewerBridge.getScene !== 'function') return null;
    return window.viewerBridge;
  }

  function listMaterialsSafe() {
    const vb = getViewer();
    if (!vb || typeof vb.listMaterials !== 'function') return [];
    const arr = vb.listMaterials() || [];
    // 安全な名称付け（unnamed対策）
    let unnamed = 0;
    return arr.map((m) => {
      let name = m?.name;
      if (!name || String(name).trim() === '') {
        unnamed += 1;
        name = `(unnamed ${unnamed})`;
      }
      return { key: name, name, ref: m };
    });
  }

  function applyToScene(materialKey, state) {
    const vb = getViewer();
    if (!vb || typeof vb.applyMaterialState !== 'function') return;
    vb.applyMaterialState(materialKey, {
      opacity: state.opacity,
      doubleSided: !!Number(state.doubleSided || 0),
      unlit: !!Number(state.unlit || 0),
      chromaEnable: !!Number(state.chromaEnable || 0),
      chromaColor: state.chromaColor || '',
      chromaTolerance: Number(state.chromaTolerance || 0),
      chromaFeather: Number(state.chromaFeather || 0),
    });
  }

  // ======== UI Setters (イベント抑止) ========
  function setOpacityUI(v) {
    suspendEvents = true;
    try {
      if (ui.rangeOpacity) ui.rangeOpacity.value = String(v);
      if (ui.outOpacity) ui.outOpacity.value = (Number(v).toFixed(2));
    } finally { suspendEvents = false; }
  }
  function setFlagsUI(state) {
    suspendEvents = true;
    try {
      if (ui.chkDouble) ui.chkDouble.checked = !!Number(state.doubleSided || 0);
      if (ui.chkUnlit) ui.chkUnlit.checked = !!Number(state.unlit || 0);
      if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!Number(state.chromaEnable || 0);
      if (ui.rangeChromaTol) ui.rangeChromaTol.value = String(state.chromaTolerance || 0);
      if (ui.rangeChromaFeather) ui.rangeChromaFeather.value = String(state.chromaFeather || 0);
    } finally { suspendEvents = false; }
  }

  function readCurrentStateFromUI(materialKey) {
    return {
      materialKey,
      opacity: Number(ui.rangeOpacity?.value ?? 1),
      doubleSided: ui.chkDouble?.checked ? 1 : 0,
      unlit: ui.chkUnlit?.checked ? 1 : 0,
      chromaEnable: ui.chkChromaEnable?.checked ? 1 : 0,
      chromaColor: '', // 予約
      chromaTolerance: Number(ui.rangeChromaTol?.value ?? 0),
      chromaFeather: Number(ui.rangeChromaFeather?.value ?? 0),
    };
  }

  // ======== Wiring ========
  function populateDropdown(materials) {
    const sel = ui.selectMaterial;
    if (!sel) return;
    sel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select —';
    sel.appendChild(opt0);
    for (const m of materials) {
      const opt = document.createElement('option');
      opt.value = m.key;
      opt.textContent = m.name;
      sel.appendChild(opt);
    }
  }

  function getDefaultState() {
    return { opacity: 1, doubleSided: 0, unlit: 0, chromaEnable: 0, chromaColor: '', chromaTolerance: 0, chromaFeather: 0 };
  }

  function onMaterialChange() {
    if (!ui.selectMaterial) return;
    const key = ui.selectMaterial.value;
    if (!key) return; // 未選択
    const saved = latestByKey.get(key) || getDefaultState();
    // 1) シーン → 2) UI の順で適用（イベント抑止）
    applyToScene(key, saved);
    setOpacityUI(saved.opacity ?? 1);
    setFlagsUI(saved);
  }

  const persistThrottled = throttle(async () => {
    if (suspendEvents) return;
    const key = ui.selectMaterial?.value;
    if (!key) return;
    const state = readCurrentStateFromUI(key);
    try {
      const row = await window.materialsSheetBridge.upsertOne(state);
      latestByKey.set(key, { ...latestByKey.get(key), ...row, ...state });
      // 直後の選択遷移でも最新が使われる
    } catch (e) {
      console.warn('[mat-orch] upsertOne failed', e);
    }
  }, 220);

  function wireUIEvents() {
    // 選択変更
    ui.selectMaterial?.addEventListener('change', onMaterialChange);

    // スライダ/チェック群 → throttled persist
    const emitChange = () => { if (!suspendEvents) persistThrottled(); };

    ui.rangeOpacity?.addEventListener('input', () => {
      if (suspendEvents) return;
      ui.outOpacity && (ui.outOpacity.value = Number(ui.rangeOpacity.value).toFixed(2));
      emitChange();
    });
    ui.rangeOpacity?.addEventListener('change', emitChange);
    ui.chkDouble?.addEventListener('change', emitChange);
    ui.chkUnlit?.addEventListener('change', emitChange);
    ui.chkChromaEnable?.addEventListener('change', emitChange);
    ui.rangeChromaTol?.addEventListener('input', emitChange);
    ui.rangeChromaFeather?.addEventListener('input', emitChange);
  }

  async function wireOnce() {
    // 1) viewerとsheet-contextの両方を待つ（順番保証）
    const [sceneEv, sheetCtx] = await Promise.all([
      waitForEventOnce('lm:scene-ready').catch(async (e) => {
        // 既にreadyなら viewer.bridge 側でイベント発火済みの可能性→ 1回だけ短い猶予
        console.warn('[mat-orch] scene-ready wait failed, retry shortly', e);
        await sleep(300);
        return waitForEventOnce('lm:scene-ready');
      }),
      waitForEventOnce('lm:sheet-context'),
    ]);
    // 2) UI確認
    assertUI();
    console.log('[mat-orch] ui ok');

    // 3) viewerからマテリアル列挙 → ドロップダウン構築
    stableMaterials = listMaterialsSafe();
    populateDropdown(stableMaterials);
    console.log('[mat-orch] panel populated', stableMaterials.length, 'materials');

    // 4) 保存値のロード（最新行に正規化）
    try {
      latestByKey = await window.materialsSheetBridge.loadAll();
    } catch (e) {
      console.warn('[mat-orch] loadAll failed (continue with empty):', e);
      latestByKey = new Map();
    }

    // 5) UIイベントを bind（この時点で行う）
    wireUIEvents();

    // 6) 初期状態：未選択。ユーザーが選んだ瞬間に onMaterialChange が保存値→シーン→UIの順で反映
    console.log('[mat-orch] wired panel');
  }

  async function boot() {
    // UI存在チェック（足りない場合は少し待って再試行）
    for (let i = 0; i < 20; i++) {
      try { assertUI(); break; }
      catch {
        await sleep(100);
      }
    }
    try {
      await wireOnce();
    } catch (e) {
      console.warn('[mat-orch] boot failed (will retry automatically)', e);
      // 再試行（低頻度）
      setTimeout(() => boot(), 1200);
    }
  }

  // kick
  boot();
})();
