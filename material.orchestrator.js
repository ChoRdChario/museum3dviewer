// material.orchestrator.js  — V6_15j_READY_BARRIER
// 目的: UI/scene/sheet の三者が揃うまで絶対に wire しない堅牢化。
// 既存機能は削らず、初期化順のみを是正。

const VERSION_TAG = 'V6_15j_READY_BARRIER';
console.log('[mat-orch] loaded VERSION_TAG:', VERSION_TAG);

// --- 小ユーティリティ ---
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function waitForDOM(idList, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    (function poll() {
      const ok = idList.every(id => document.getElementById(id));
      if (ok) return resolve(true);
      if (performance.now() - t0 > timeoutMs) {
        return reject(new Error('UI controls not found'));
      }
      requestAnimationFrame(poll);
    })();
  });
}

function waitForEventOnce(target, type, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let to = setTimeout(() => {
      cleanup();
      reject(new Error(`waitForEventOnce timeout: ${type}`));
    }, timeoutMs);
    const handler = (ev) => {
      cleanup();
      resolve(ev);
    };
    function cleanup() {
      clearTimeout(to);
      target.removeEventListener(type, handler);
    }
    target.addEventListener(type, handler, { once: true });
  });
}

// sheet の現在値を知るためのヘルパ（bridge 実装に依存せず使える）
function isSheetReady() {
  // sheet.ctx.bridge.js が発火するオブジェクト構造に依存
  return !!(window.__lm_sheetCtx && window.__lm_sheetCtx.spreadsheetId);
}

// viewer が ready か判定（bridge 実装に依存しない安全側判定）
function isSceneReady() {
  try {
    return !!(window.viewerBridge && typeof viewerBridge.getScene === 'function' && viewerBridge.getScene());
  } catch (_) { return false; }
}

// 両ブリッジが揃うまで待つ。どちらかが先に来ても OK。
async function waitForBridges() {
  const waitScene = (async () => {
    if (isSceneReady()) return;
    await waitForEventOnce(window, 'lm:scene-ready');
  })();

  const waitSheet = (async () => {
    if (isSheetReady()) return;
    await waitForEventOnce(window, 'lm:sheet-context');
  })();

  await Promise.all([waitScene, waitSheet]);
}

// 直近の loadAll 値を UI と scene に適用
function applySavedToUIAndScene(savedMap, ui) {
  // savedMap: materialKey -> { opacity, ... }
  // UI: { sel, range, out }
  // まず選択中の materialKey の保存値でスライダ初期値を合わせる
  const key = ui.sel.value || '';
  const rec = savedMap.get(key);
  if (rec && typeof rec.opacity === 'number') {
    ui.range.value = String(rec.opacity);
    ui.out.value   = (Math.round(rec.opacity * 100) / 100).toFixed(2);
  }
  // scene 反映（存在すれば）。viewerBridge 側の API 差異に配慮して複数名を試行
  try {
    if (key && rec && typeof rec.opacity === 'number' && window.viewerBridge) {
      const v = viewerBridge;
      const val = rec.opacity;
      if (typeof v.setMaterialOpacity === 'function')       v.setMaterialOpacity(key, val);
      else if (typeof v.applyMaterialOpacity === 'function') v.applyMaterialOpacity(key, val);
      else if (typeof v.updateOpacityForMaterial === 'function') v.updateOpacityForMaterial(key, val);
      // 上記いずれも無ければ「scene 表示」はスキップ（保存は別途 upsert で担保）
    }
  } catch (e) {
    console.warn('[mat-orch] apply to scene skipped:', e);
  }
}

// throttle（連打吸収）
function throttle(fn, ms) {
  let busy = false, lastArgs = null;
  return (...args) => {
    lastArgs = args;
    if (busy) return;
    busy = true;
    setTimeout(() => {
      busy = false;
      if (lastArgs) fn(...lastArgs);
      lastArgs = null;
    }, ms);
  };
}

// --- メイン ---
let wired = false;

async function wireOnce() {
  if (wired) return;
  wired = true;

  // 1) UI を待つ
  const UI_IDS = ['pm-material', 'pm-opacity-range', 'pm-opacity-val'];
  await waitForDOM(UI_IDS).catch((e) => { 
    console.warn('[mat-orch] boot failed (will retry automatically)', e);
    wired = false; // 失敗したら再試行を許す
    throw e;
  });
  const ui = {
    sel:   document.getElementById('pm-material'),
    range: document.getElementById('pm-opacity-range'),
    out:   document.getElementById('pm-opacity-val'),
  };
  console.log('[mat-orch] ui ok');

  // 2) viewer / sheet の両方が ready になるまで待つ
  await waitForBridges().catch((e) => {
    console.warn('[mat-orch] boot failed (will retry automatically)', e);
    wired = false;
    throw e;
  });

  // 3) 材質セレクトを埋める（scene-ready 後に取得）
  let mats = [];
  try {
    mats = (viewerBridge && typeof viewerBridge.listMaterials === 'function')
      ? (viewerBridge.listMaterials() || [])
      : [];
  } catch (e) {
    console.warn('[mat-orch] listMaterials failed (0扱い):', e);
  }

  // 既存 options を消してから埋める
  ui.sel.innerHTML = '';
  const opt0 = document.createElement('option');
  opt0.value = '';
  opt0.textContent = '— Select —';
  ui.sel.appendChild(opt0);
  for (const m of mats) {
    const opt = document.createElement('option');
    opt.value = (m.key || m.name || '').toString();
    opt.textContent = (m.name || m.key || '(unnamed)').toString();
    ui.sel.appendChild(opt);
  }
  console.log('[mat-orch] panel populated', mats.length, 'materials');

  // 4) 先にシート保存値を読み込んで適用
  let savedMap = new Map();
  try {
    if (window.materialsSheetBridge && typeof materialsSheetBridge.loadAll === 'function') {
      const all = await materialsSheetBridge.loadAll(); // 期待: Map(materialKey -> record)
      if (all && typeof all.forEach === 'function') savedMap = all;
    } else {
      console.warn('[mat-orch] materialsSheetBridge.loadAll not available');
    }
  } catch (e) {
    console.warn('[mat-orch] loadAll failed (continue with empty):', e);
  }

  // 初期 UI & scene へ反映（選択中 key に合わせる）
  applySavedToUIAndScene(savedMap, ui);

  // 5) UI イベント bind（最後に）
  const applyOpacityThrottled = throttle(async (materialKey, value) => {
    // scene へ反映
    try {
      if (window.viewerBridge) {
        const v = viewerBridge;
        if (typeof v.setMaterialOpacity === 'function')       v.setMaterialOpacity(materialKey, value);
        else if (typeof v.applyMaterialOpacity === 'function') v.applyMaterialOpacity(materialKey, value);
        else if (typeof v.updateOpacityForMaterial === 'function') v.updateOpacityForMaterial(materialKey, value);
      }
    } catch (e) {
      console.warn('[mat-orch] scene apply skipped:', e);
    }

    // シートへ追記
    try {
      if (window.materialsSheetBridge && typeof materialsSheetBridge.upsertOne === 'function') {
        await materialsSheetBridge.upsertOne({
          key: 'opacity',
          materialKey,
          opacity: value,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[mat-orch] upsertOne failed', e);
    }
  }, 220);

  ui.sel.addEventListener('change', () => {
    // 選択切り替え時：保存値でスライダ初期値を合わせる
    applySavedToUIAndScene(savedMap, ui);
  });

  ui.range.addEventListener('input', () => {
    const val = Number(ui.range.value || 1);
    ui.out.value = (Math.round(val * 100) / 100).toFixed(2);
  });

  ui.range.addEventListener('change', () => {
    const materialKey = ui.sel.value;
    if (!materialKey) return;
    const val = Number(ui.range.value || 1);
    applyOpacityThrottled(materialKey, val);
  });

  console.log('[mat-orch] wired panel');
}

// --- 自動再試行（UI/scene/sheet のいずれかが遅延しても最終的に一度だけ wire） ---
(async function autoMaybeWire() {
  // DOM 完了後に開始
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMaybeWire, { once: true });
    return;
  }
  try {
    await wireOnce();
  } catch (_) {
    // 少し待って再トライ（UI or bridges がまだの可能性）
    await sleep(300);
    try { await wireOnce(); } catch (__) { /* 以後はイベントで再トライ */ }
  }

  // 遅延で届くイベントでもう一度だけトライ
  window.addEventListener('lm:scene-ready', () => { wireOnce(); }, { once: true });
  window.addEventListener('lm:sheet-context', () => { wireOnce(); }, { once: true });
})();
