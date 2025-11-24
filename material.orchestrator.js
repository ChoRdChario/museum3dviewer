// material.orchestrator.js
(function () {
  const LOG_PREFIX = '[mat-orch]';
  const VERSION_TAG = 'V6_16_SHEET_MAT_CACHE_FIX';

  console.log(LOG_PREFIX, 'loaded', 'VERSION_TAG:' + VERSION_TAG);

  /**
   * グローバル状態
   */
  let materialSelectEl = null;
  let opacityRangeEl = null;
  let opacityValueEl = null;

  // 現在アクティブなマテリアルキー（ドロップダウンの value）
  let currentMaterialKey = null;

  // 現在アクティブなキャプションシートの GID
  let currentSheetGid = null;

  // sheetGid ごとのマテリアル設定キャッシュ
  // Map<sheetGid: string, Map<materialKey: string, MaterialProps>>
  const sheetMaterialCache = new Map();

  // ドロップダウンに流し込むマテリアル一覧
  let materialList = [];

  // __LM_MATERIALS の取得レンジ
  const MATERIALS_RANGE = '__LM_MATERIALS!A2:N';

  /**
   * Viewer 側とのブリッジ
   * window.LociMyuViewerBridge が用意されている前提
   */
  function getViewerBridge() {
    return window.LociMyuViewerBridge || window.viewerBridge || null;
  }

  /**
   * 現在の viewer からマテリアル一覧を取得
   * 戻り値: Array<{ key: string, name: string }>
   */
  function getMaterialsFromViewer() {
    const bridge = getViewerBridge();
    if (!bridge || typeof bridge.listMaterials !== 'function') {
      console.warn(LOG_PREFIX, 'viewer bridge not ready (listMaterials)');
      return [];
    }

    try {
      const list = bridge.listMaterials() || [];
      return list
        .map(m => ({
          key: m.key || m.name || '',
          name: m.name || m.key || '',
        }))
        .filter(m => m.key);
    } catch (err) {
      console.error(LOG_PREFIX, 'failed to list materials', err);
      return [];
    }
  }

  /**
   * 指定マテリアルにプロパティを適用
   */
  function applyMaterialProps(materialKey, props) {
    const bridge = getViewerBridge();
    if (!bridge || typeof bridge.applyMaterialProps !== 'function') {
      console.warn(LOG_PREFIX, 'viewer bridge not ready (applyMaterialProps)');
      return;
    }

    try {
      bridge.applyMaterialProps(materialKey, props);
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'failed to apply material props',
        materialKey,
        props,
        err,
      );
    }
  }

  /**
   * 現在の sheetGid と materialKey に対する props をキャッシュに保存しつつ、
   * __LM_MATERIALS シートにも反映するユーティリティ
   */
  function persistAndCache(materialKey, props) {
    const ctx =
      window.__LM_SHEET_CTX || { spreadsheetId: '', sheetGid: currentSheetGid || '0' };
    const spreadsheetId = ctx.spreadsheetId;
    const sheetGid = String(ctx.sheetGid || currentSheetGid || '0');

    if (!materialKey) return;

    // ローカルキャッシュ更新
    const key = `${sheetGid}::${materialKey}`;
    let map = sheetMaterialCache.get(sheetGid) || new Map();
    map.set(materialKey, props);
    sheetMaterialCache.set(sheetGid, map);

    // シートへの保存
    if (!spreadsheetId || spreadsheetId === 'dummy') {
      console.warn(LOG_PREFIX, 'No spreadsheetId in ctx; skip persist');
      return;
    }

    if (
      !window.LM_MaterialsPersist ||
      typeof window.LM_MaterialsPersist.upsert !== 'function'
    ) {
      console.warn(LOG_PREFIX, 'LM_MaterialsPersist.upsert not ready; skip persist');
      return;
    }

    try {
      window.LM_MaterialsPersist.upsert({
        materialKey,
        ...props,
      });
    } catch (err) {
      console.error(LOG_PREFIX, 'failed to upsert material row', key, err);
    }
  }

  /**
   * 現在の UI (opacityRange) を、指定された props に同期
   */
  function syncUIFromProps(props) {
    if (!opacityRangeEl || !opacityValueEl) return;

    const opacity =
      props && typeof props.opacity === 'number'
        ? props.opacity
        : props && typeof props.opacity === 'string'
          ? parseFloat(props.opacity) || 1.0
          : 1.0;

    const clamped = Math.max(0.0, Math.min(1.0, opacity));
    opacityRangeEl.value = String(clamped);
    opacityValueEl.textContent = clamped.toFixed(2);
  }

  /**
   * 現在の materialSelect と opacityRange の状態を返す
   */
  function getCurrentUIState() {
    const materialKey = materialSelectEl ? materialSelectEl.value : null;
    let opacity = 1.0;
    if (opacityRangeEl) {
      const v = parseFloat(opacityRangeEl.value);
      opacity = isNaN(v) ? 1.0 : v;
    }
    return { materialKey, opacity };
  }

  /**
   * 現在の sheet & material に対応する props をキャッシュから取得
   */
  function getPropsFromCache(sheetGid, materialKey) {
    const gid = String(sheetGid || '0');
    const map = sheetMaterialCache.get(gid);
    if (!map) return null;
    return map.get(materialKey) || null;
  }

  /**
   * 現在のキャプションシートに対するマテリアル設定をすべて viewer に適用
   */
  function applyAllToScene(map) {
    const bridge = getViewerBridge();
    if (!bridge || typeof bridge.resetAllMaterials !== 'function') {
      console.warn(LOG_PREFIX, 'viewer bridge not ready (resetAllMaterials)');
      return;
    }

    try {
      bridge.resetAllMaterials();
    } catch (err) {
      console.error(LOG_PREFIX, 'failed to resetAllMaterials', err);
    }

    if (!map || !(map instanceof Map)) return;

    for (const entry of map.entries()) {
      const key = entry[0];
      const props = Object.assign(
        {
          opacity: 1.0,
          doubleSided: false,
          unlitLike: false,
          chromaEnable: false,
          chromaColor: '#000000',
          chromaTolerance: 0.1,
          chromaFeather: 0.0,
        },
        entry[1] || {},
      );
      applyMaterialProps(key, props);
    }
  }

  /**
   * 現在の sheetGid に対して __LM_MATERIALS シートを読み込み、
   * sheetMaterialCache を更新して Map を返す
   *
   * 新フォーマット/旧フォーマット両方に対応
   */
  async function fetchAndCacheMaterials(spreadsheetId, sheetGid) {
    const cacheKey = String(sheetGid || '0');

    // すでにキャッシュ済みならそれを返す
    if (sheetMaterialCache.has(cacheKey)) {
      const existing = sheetMaterialCache.get(cacheKey);
      console.log(
        LOG_PREFIX,
        '[cache hit] materials for sheet',
        cacheKey,
        'keys:',
        existing.size,
      );
      return existing;
    }

    if (!spreadsheetId || spreadsheetId === 'dummy') {
      console.warn(LOG_PREFIX, 'No spreadsheetId; skip fetch');
      const empty = new Map();
      sheetMaterialCache.set(cacheKey, empty);
      return empty;
    }

    console.log(
      LOG_PREFIX,
      'Fetching materials for sheetGid',
      cacheKey,
      'from __LM_MATERIALS...',
    );
    const base = 'https://sheets.googleapis.com/v4/spreadsheets/';
    const url =
      base +
      encodeURIComponent(spreadsheetId) +
      '/values/' +
      encodeURIComponent(MATERIALS_RANGE);

    try {
      const res = await (window.__lm_fetchJSONAuth
        ? window.__lm_fetchJSONAuth('GET', url)
        : fetch(url).then(r => r.json()));

      const rows = (res && res.values) || [];
      const map = new Map();

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i] || [];
        const mKey = (r[0] || '').trim();
        if (!mKey) continue;

        let mGid = '';
        let opacity = 1.0;
        let doubleSided = false;
        let unlitLike = false;
        let chromaEnable = false;
        let chromaColor = '#000000';
        let chromaTolerance = 0.0;
        let chromaFeather = 0.0;

        // 新フォーマット
        // A:materialKey, B:name, C:opacity, D:doubleSided, E:unlitLike,
        // F:chromaEnable, G:chromaTolerance, H:chromaFeather,
        // I:roughness, J:metalness, K:emissiveHex,
        // L:updatedAt, M:updatedBy, N:sheetGid
        if (r.length >= 14) {
          mGid = String(r[13] || '').trim();
          opacity = r[2] !== undefined && r[2] !== '' ? parseFloat(r[2]) : 1.0;
          doubleSided = String(r[3] || '').toUpperCase() === 'TRUE';
          unlitLike = String(r[4] || '').toUpperCase() === 'TRUE';
          chromaEnable = String(r[5] || '').toUpperCase() === 'TRUE';
          chromaTolerance =
            r[6] !== undefined && r[6] !== '' ? parseFloat(r[6]) : 0.0;
          chromaFeather =
            r[7] !== undefined && r[7] !== '' ? parseFloat(r[7]) : 0.0;

          // 旧フォーマットとの後方互換
        } else if (r.length >= 12) {
          // 旧: A:materialKey, B:name, C:opacity, D:doubleSided, E:unlitLike,
          // F:chromaEnable, G:chromaColor, H:chromaTolerance, I:chromaFeather,
          // J:notes, K:captionSheetTitle, L:sheetGid
          mGid = String(r[11] || '').trim() || '0';
          opacity = r[2] !== undefined && r[2] !== '' ? parseFloat(r[2]) : 1.0;
          doubleSided = String(r[3] || '').toUpperCase() === 'TRUE';
          unlitLike = String(r[4] || '').toUpperCase() === 'TRUE';
          chromaEnable = String(r[5] || '').toUpperCase() === 'TRUE';
          chromaColor = r[6] || '#000000';
          chromaTolerance =
            r[7] !== undefined && r[7] !== '' ? parseFloat(r[7]) : 0.1;
          chromaFeather =
            r[8] !== undefined && r[8] !== '' ? parseFloat(r[8]) : 0.0;
        } else {
          // 想定外フォーマット
          continue;
        }

        if (!mGid) mGid = '0';

        if (mGid === cacheKey) {
          map.set(mKey, {
            opacity,
            doubleSided,
            unlitLike,
            chromaEnable,
            chromaColor,
            chromaTolerance,
            chromaFeather,
          });
        }
      }

      sheetMaterialCache.set(cacheKey, map);
      console.log(
        LOG_PREFIX,
        'Data Loaded. Keys:',
        map.size,
        'for sheetGid',
        cacheKey,
      );
      return map;
    } catch (err) {
      console.error(
        LOG_PREFIX,
        'Failed to fetch materials for sheetGid',
        cacheKey,
        err,
      );
      const empty = new Map();
      sheetMaterialCache.set(cacheKey, empty);
      return empty;
    }
  }

  /**
   * シートコンテキスト変更イベントを処理
   * ev.detail = { spreadsheetId, sheetGid, sheetTitle, ... }
   */
  function handleSheetContextChange(ctx) {
    if (!ctx || !ctx.sheetGid) {
      console.warn(LOG_PREFIX, 'sheet context missing or invalid', ctx);
      return;
    }

    const newSid = ctx.spreadsheetId;
    const newGid = String(ctx.sheetGid);

    console.log(LOG_PREFIX, 'sheet-context bound gid', newGid);

    currentSheetGid = newGid;

    // UI 上のアクティブマテリアルはリセットしておく
    currentMaterialKey = null;

    // キャッシュがあればそれを適用、なければ __LM_MATERIALS を読み込み
    if (sheetMaterialCache.has(newGid)) {
      const map = sheetMaterialCache.get(newGid);
      console.log(LOG_PREFIX, '[sheet change] cache hit, keys:', map.size);
      applyAllToScene(map);
      updateUIFromMaterialsCache();
    } else {
      console.log(LOG_PREFIX, '[sheet change] cache miss, fetching...');
      fetchAndCacheMaterials(newSid, newGid)
        .then(map => {
          applyAllToScene(map);
          updateUIFromMaterialsCache();
        })
        .catch(err => {
          console.error(
            LOG_PREFIX,
            'failed to fetch materials on sheet change',
            err,
          );
        });
    }
  }

  /**
   * materialSelect + opacityRange を sheetMaterialCache 現在値で更新
   */
  function updateUIFromMaterialsCache() {
    if (!materialSelectEl || !currentSheetGid) return;

    const selectedKey = materialSelectEl.value;
    if (!selectedKey) return;

    const props =
      getPropsFromCache(currentSheetGid, selectedKey) || { opacity: 1.0 };
    syncUIFromProps(props);
  }

  /**
   * materialSelect の change ハンドラ
   */
  function handleMaterialSelectChange(ev) {
    const key = ev && ev.target ? ev.target.value : null;
    currentMaterialKey = key || null;

    if (!currentSheetGid || !currentMaterialKey) {
      syncUIFromProps({ opacity: 1.0 });
      return;
    }

    const props =
      getPropsFromCache(currentSheetGid, currentMaterialKey) || { opacity: 1.0 };
    syncUIFromProps(props);
  }

  /**
   * opacityRange の input ハンドラ（リアルタイム反映のみ: シートには書かない）
   */
  function handleOpacityInput(ev) {
    if (!opacityRangeEl || !opacityValueEl) return;

    const v = parseFloat(opacityRangeEl.value);
    const opacity = isNaN(v) ? 1.0 : Math.max(0.0, Math.min(1.0, v));
    opacityValueEl.textContent = opacity.toFixed(2);

    if (!currentSheetGid || !currentMaterialKey) return;

    // 軽量なリアルタイム描画のみ
    applyMaterialProps(currentMaterialKey, { opacity });
  }

  /**
   * opacityRange の change ハンドラ（確定時: シート保存＋キャッシュ更新）
   */
  function handleOpacityCommit(ev) {
    if (!currentSheetGid || !currentMaterialKey) return;
    if (!opacityRangeEl) return;

    const v = parseFloat(opacityRangeEl.value);
    const opacity = isNaN(v) ? 1.0 : Math.max(0.0, Math.min(1.0, v));

    const props = {
      opacity,
      // 今後 doubleSided / unlitLike / chroma* を UI に追加したらここでまとめて保存する
    };

    // ローカルキャッシュ＋シートに保存
    persistAndCache(currentMaterialKey, props);

    // 最終値で viewer を更新
    applyMaterialProps(currentMaterialKey, props);
  }

  /**
   * UI エレメントの取得とイベントバインド
   */
  function wireUI() {
    materialSelectEl = document.querySelector('#materialSelect');
    opacityRangeEl = document.querySelector('#opacityRange');
    opacityValueEl = document.querySelector('#opacityValue');

    if (!materialSelectEl || !opacityRangeEl || !opacityValueEl) {
      console.warn(
        LOG_PREFIX,
        'UI elements not found (materialSelect/opacityRange/opacityValue)',
      );
      return false;
    }

    materialSelectEl.addEventListener('change', handleMaterialSelectChange);
    opacityRangeEl.addEventListener('input', handleOpacityInput);
    opacityRangeEl.addEventListener('change', handleOpacityCommit);

    console.log(LOG_PREFIX, 'UI wired');
    return true;
  }

  /**
   * materialSelect に viewer のマテリアル一覧を流し込み
   */
  function populateMaterialSelect() {
    if (!materialSelectEl) return;

    materialList = getMaterialsFromViewer();
    materialSelectEl.innerHTML = '';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '(select material)';
    materialSelectEl.appendChild(emptyOpt);

    for (const m of materialList) {
      const opt = document.createElement('option');
      opt.value = m.key;
      opt.textContent = m.name || m.key;
      materialSelectEl.appendChild(opt);
    }

    console.log(LOG_PREFIX, 'materialSelect populated', materialList.length, 'items');
  }

  /**
   * scene-ready / sheet-context イベント購読
   */
  function wireEvents() {
    // シーン準備完了
    window.addEventListener('lm:scene-ready', () => {
      console.log(LOG_PREFIX, 'scene-ready');
      populateMaterialSelect();
      updateUIFromMaterialsCache();
    });

    // スプレッドシートのシートコンテキスト（キャプションシート）が変わった
    window.addEventListener('lm:sheet-context', ev => {
      const ctx = (ev && ev.detail) || null;
      handleSheetContextChange(ctx || window.__LM_SHEET_CTX || null);
    });
  }

  /**
   * 初期化
   */
  function boot() {
    if (!wireUI()) {
      console.log(LOG_PREFIX, 'ui not ready yet, retry...');
      setTimeout(boot, 500);
      return;
    }

    wireEvents();

    // 初期状態で viewer がすでに ready の場合に備え、手動で populate
    populateMaterialSelect();

    console.log(LOG_PREFIX, 'boot complete');
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        boot();
      },
      { once: true },
    );
  } else {
    boot();
  }
})();
