/* ==========================================================================
  LociMyu – Per-Material Opacity Runtime
  - 既存UIを壊さず、「マテリアル」タブ内のプルダウン/スライダーに連動
  - HTML編集なしでも動くよう、セレクタ検出を強化
  - gid別に localStorage 保存（キー: LM:permat:opacity:<gid>）
  - lm:scene-ready を利用。未発火でも自動で一度だけ発火を試みる
=========================================================================== */

(function () {
  // ===== ログ制御（スパム防止）=====
  const Log = (() => {
    const warned = new Set();
    return {
      info: (...a) => console.log('[per-mat]', ...a),
      warnOnce: (key, ...a) => {
        if (warned.has(key)) return;
        warned.add(key);
        console.warn('[per-mat]', ...a);
      },
      error: (...a) => console.error('[per-mat]', ...a),
    };
  })();

  // ===== ユーティリティ =====
  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else {
      fn();
    }
  }

  function getGid() {
    // 既存 UI の「シート選択」から gid っぽいものを拾う
    const sheetSel =
      document.querySelector('select[name="sheet"], select[id*="sheet"]') ||
      document.querySelector('#pm-sheet, [data-lm="sheet-select"]');
    const v = sheetSel?.value || '';
    const m = v.match(/gid=(\d+)/);
    return m ? m[1] : (v || '0');
  }
  const storeKey = (gid) => `LM:permat:opacity:${gid}`;
  function loadMap() {
    try {
      return JSON.parse(localStorage.getItem(storeKey(getGid())) || '{}');
    } catch {
      return {};
    }
  }
  function saveMap(map) {
    localStorage.setItem(storeKey(getGid()), JSON.stringify(map));
  }

  // ===== UI 要素の検出（HTML編集なしでも通るように多段フェイルオーバー）=====
  function pickMaterialSelect() {
    // 最優先: data-lm 属性
    let el =
      document.querySelector('[data-lm="mat-per-select"]') ||
      // 次点: 以前案内した推奨 id
      document.getElementById('pm-material') ||
      // 右パネルの MATERIAL タブにいる select
      document.querySelector('#pane-material select') ||
      // よくある名前・aria-labelを総当り
      [...document.querySelectorAll('select')].find((s) => {
        const txt =
          (s.textContent || '') + ' ' + (s.getAttribute('aria-label') || '');
        return /select material|material/i.test(txt);
      });
    return el || null;
  }

  function pickOpacitySlider() {
    let el =
      document.querySelector('[data-lm="mat-per-slider"]') ||
      document.getElementById('pm-opacity') ||
      document.querySelector('#pane-material input[type="range"]') ||
      [...document.querySelectorAll('input[type="range"]')].find((r) => {
        const min = +r.min;
        const max = +r.max;
        return min === 0 && (max === 1 || max === 100);
      });
    return el || null;
  }

  // ===== シーン取得 =====
  function getScene() {
    // 既に捕獲済みなら使う
    const s =
      window.__LM_SCENE ||
      window.scene ||
      window.viewer?.scene ||
      window.viewer?.three?.scene ||
      window.app?.scene ||
      null;
    return s || null;
  }

  function armRendererHookOnce() {
    // Three.js の render を一度だけフックし、最初の描画時に __LM_SCENE を捕獲
    try {
      const THREE = window.THREE || window.viewer?.THREE || window.app?.THREE;
      const R = THREE?.WebGLRenderer;
      if (!R || R.prototype.__lm_render_hooked) return;

      const orig = R.prototype.render;
      R.prototype.render = function (scene, camera) {
        if (scene?.isScene && !window.__LM_SCENE) {
          window.__LM_SCENE = scene;
          Log.info('scene captured via render hook');
        }
        return orig.apply(this, arguments);
      };
      R.prototype.__lm_render_hooked = true;
      Log.info('renderer hook armed');
    } catch (e) {
      // 失敗しても致命ではない
    }
  }

  // ====== マテリアル収集 ======
  function collectMaterials(scene) {
    const uniq = new Map();
    let meshCount = 0;
    scene.traverse((o) => {
      if (!o?.isMesh) return;
      meshCount++;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        if (!m) return;
        if (!uniq.has(m.uuid)) uniq.set(m.uuid, m);
      });
    });
    const list = [...uniq.values()];
    return { list, meshCount };
  }

  function applyOpacity(mat, val) {
    mat.transparent = true;
    mat.opacity = val;
    if (mat.alphaTest && val < 1 && mat.alphaTest > 0.5) mat.alphaTest = 0.5; // ありがちな衝突を回避
    mat.needsUpdate = true;
  }

  // ====== メイン初期化 ======
  function bootOnce() {
    const select = pickMaterialSelect();
    const slider = pickOpacitySlider();

    if (!select || !slider) {
      Log.warnOnce(
        'no-ui',
        'UI elements not found (select/slider). タブを開いた後にもう一度読み込みます。'
      );
      return false;
    }

    const scene = getScene();
    if (!scene) {
      Log.warnOnce('no-scene', 'scene not found yet. 後で再試行します。');
      armRendererHookOnce();
      return false;
    }

    // DOMの placeholder を差し替え
    select.innerHTML = '';
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = '— Select material —';
    select.appendChild(ph);

    // 収集して一覧化
    const { list } = collectMaterials(scene);
    if (!list.length) {
      Log.warnOnce('no-mats', 'materials not found in scene.');
      return false;
    }

    // ラベル生成（無名は type + 短縮UUID）
    const makeLabel = (m) =>
      (m.name || '').trim() || `${m.type || 'Material'}_${m.uuid.slice(-6)}`;

    // 辞書を保持（uuid → material）
    const dict = {};
    list.forEach((m) => (dict[m.uuid] = m));

    // 一覧を投入（英字ソート）
    list
      .map((m) => ({ uuid: m.uuid, label: makeLabel(m) }))
      .sort((a, b) => a.label.localeCompare(b.label, 'en'))
      .forEach((o) => {
        const op = document.createElement('option');
        op.value = o.uuid;
        op.textContent = o.label;
        select.appendChild(op);
      });

    // 既存保存値を一括適用
    const map = loadMap();
    Object.entries(map).forEach(([uuid, val]) => {
      const mat = dict[uuid];
      if (!mat) return;
      applyOpacity(mat, +val);
    });

    // 連動
    select.onchange = () => {
      const uuid = select.value;
      const mat = dict[uuid];
      if (!uuid || !mat) return;
      slider.value = String(mat.opacity ?? 1);
    };

    slider.oninput = () => {
      const uuid = select.value;
      const mat = dict[uuid];
      if (!uuid || !mat) return;
      const v = +slider.value;
      applyOpacity(mat, v);
      const m2 = loadMap();
      m2[uuid] = v;
      saveMap(m2);
    };

    Log.info('ready. options=', select.options.length - 1);
    return true;
  }

  // ====== 起動フロー ======
  onReady(() => {
    let armed = false;

    // 1) シーンが来たら即初期化
    document.addEventListener(
      'lm:scene-ready',
      () => {
        if (armed) return;
        armed = true;
        setTimeout(() => bootOnce(), 0);
      },
      { once: true }
    );

    // 2) 予防的に自前で一度だけ発火を試みる（ページによっては発火済み）
    setTimeout(() => {
      try {
        if (window.__LM_SCENE?.isScene) {
          const ev = new CustomEvent('lm:scene-ready', {
            detail: { scene: window.__LM_SCENE },
          });
          document.dispatchEvent(ev);
          // console.log('[boot] lm:scene-ready dispatched (self)');
        }
      } catch {}
    }, 300);

    // 3) タブを開いたタイミングでも初期化を試行（HTML編集なしで動かすため）
    document.addEventListener('click', (e) => {
      const t = e.target;
      const txt = (t?.textContent || '').toLowerCase();
      if (
        /material/.test(txt) ||
        t?.matches?.('#tab-material, [data-tab="material"]')
      ) {
        setTimeout(() => bootOnce(), 10);
      }
    });

    // 4) 保険：数秒だけポーリングして UI/scene が揃えば初期化
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      if (bootOnce()) {
        clearInterval(timer);
      } else if (tries > 20) {
        clearInterval(timer);
      }
    }, 400);
  });
})();
