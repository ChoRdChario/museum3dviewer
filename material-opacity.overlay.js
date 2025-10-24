<script>
// LociMyu - Per-Material Opacity Overlay (drop-in)
// UIはMaterialタブ内に埋め込み/保存はlocalStorage。セーブIDは window.__LM_SAVE_ID または
// シートドロップダウン/URL/ファイル名から推測。モデルロード後に自動適用。
// 既存コードは一切編集不要。

(function () {
  const STORAGE_PREFIX = 'lm_opacity_';
  const log = (...a)=>console.log('[LM-Opacity]', ...a);

  // ===== セーブIDの推定/設定 =====
  function getSaveId() {
    // 1) 明示指定
    if (window.__LM_SAVE_ID) return String(window.__LM_SAVE_ID);
    // 2) セレクトボックス(“Select sheet…”)のvalueや選択テキスト
    const sel = document.querySelector('select, #sheet-select, [name="sheet"]');
    if (sel && sel.value) return 'sheet:' + sel.value;
    if (sel && sel.options && sel.selectedIndex>=0) {
      const txt = sel.options[sel.selectedIndex]?.text?.trim();
      if (txt) return 'sheet:' + txt;
    }
    // 3) URLのid=gid風 or ファイル名っぽい識別子
    const m = location.search.match(/[?&]id=([^&]+)/) || location.search.match(/[?&]gid=([^&]+)/);
    if (m) return 'gid:' + decodeURIComponent(m[1]);
    const glb = (document.getElementById('glbUrl')?.value||'').trim();
    if (glb) return 'glb:' + glb.replace(/^.*\//,'');
    // 4) 既定
    return 'default';
  }

  // ===== 保存/読込 =====
  function loadMap(saveId) {
    try {
      const raw = localStorage.getItem(STORAGE_PREFIX + saveId);
      if (!raw) return {version:1, materials:{}};
      const j = JSON.parse(raw);
      return (j && j.materials) ? j : {version:1, materials:{}};
    } catch { return {version:1, materials:{}}; }
  }
  function saveMap(saveId, map) {
    try {
      localStorage.setItem(STORAGE_PREFIX + saveId, JSON.stringify({version:1, materials:map}));
    } catch(e){ console.warn(e); }
  }

  // ===== THREEシーンからマテリアル一覧/適用 =====
  function getScene() {
    return window.scene || window.__LM_SCENE || null;
  }
  function collectMaterials(scene) {
    const set = new Map();
    if (!scene) return set;
    scene.traverse(obj => {
      const mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) mat.forEach(m=>{ if(m && m.name) set.set(m.name, m); });
      else if (mat.name) set.set(mat.name, mat);
    });
    return set;
  }
  function applyOpacity(scene, map) {
    if (!scene) return;
    scene.traverse(obj => {
      const mats = obj.material ? (Array.isArray(obj.material) ? obj.material : [obj.material]) : [];
      mats.forEach(m=>{
        if (!m || !m.name) return;
        const op = map[m.name];
        if (typeof op === 'number') {
          m.transparent = (op < 1.0) || m.transparent;
          m.opacity = Math.max(0, Math.min(1, op));
          // alphaTest等を触らずに安全サイド
          m.needsUpdate = true;
        }
      });
    });
  }

  // ===== UIの組み込み（Materialタブ内に差し込み） =====
  function findMaterialTabContainer() {
    // タブ本体の右側ペイン内を広めに探索
    // 「Material」という文言が入る見出し/タブを探し、その直後のパネルを使う
    const labels = Array.from(document.querySelectorAll('*'))
      .filter(el => el.textContent && /material/i.test(el.textContent) && el.clientHeight<80 && el.clientWidth<600);
    for (const lab of labels) {
      // ラベルの近くにあるパネル領域を探す
      let p = lab.closest('.panel,.tab-pane,.content') || lab.parentElement;
      while (p && p.children && p.children.length<1) p = p.parentElement;
      if (p) return p;
    }
    // だめなら右側ペインらしきところ
    const right = document.querySelector('#right,#ui,#side,.sidebar');
    return right || document.body;
  }

  function buildUI(saveId, scene, matsMap) {
    const host = findMaterialTabContainer();
    if (!host) return;
    // 既に設置済みなら使い回し
    let wrap = host.querySelector('#lm-opacity-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.id = 'lm-opacity-wrap';
      wrap.style.margin = '12px 0';
      wrap.style.padding = '12px';
      wrap.style.background = 'rgba(255,255,255,0.04)';
      wrap.style.border = '1px solid rgba(255,255,255,0.08)';
      wrap.style.borderRadius = '8px';
      wrap.innerHTML = `
        <div style="display:flex;align-items:center;gap:12px;justify-content:space-between;">
          <div style="font-weight:600">Per-Material Opacity</div>
          <div style="display:flex;gap:6px;align-items:center;">
            <input id="lm-opacity-search" type="text" placeholder="filter material…" style="background:#171a1f;border:1px solid #2a2f36;color:#dbe0e8;border-radius:6px;padding:4px 8px;">
            <button id="lm-opacity-reset" style="background:#2b2f3a;border:1px solid #3a4150;color:#dbe0e8;border-radius:6px;padding:6px 10px;cursor:pointer;">Reset</button>
            <button id="lm-opacity-allhalf" style="background:#2b2f3a;border:1px solid #3a4150;color:#dbe0e8;border-radius:6px;padding:6px 10px;cursor:pointer;">50%</button>
          </div>
        </div>
        <div style="margin:10px 0 6px;">Master</div>
        <input id="lm-opacity-master" type="range" min="0" max="1" step="0.01" value="1" style="width:100%;">
        <div id="lm-opacity-list" style="margin-top:10px;max-height:260px;overflow:auto;display:grid;grid-template-columns:1fr;gap:8px;"></div>
        <div id="lm-opacity-foot" style="margin-top:8px;font-size:12px;opacity:.75">Save: <code id="lm-opacity-saveid"></code></div>
      `;
      host.appendChild(wrap);
    }

    wrap.querySelector('#lm-opacity-saveid').textContent = saveId;

    // マテリアルカード生成
    const saved = loadMap(saveId).materials;
    const list = wrap.querySelector('#lm-opacity-list');
    list.innerHTML = '';

    const mats = Array.from(matsMap.keys()).sort((a,b)=>a.localeCompare(b));
    mats.forEach(name=>{
      const val = (typeof saved[name]==='number') ? saved[name] : 1.0;
      const row = document.createElement('div');
      row.style.display = 'grid';
      row.style.gridTemplateColumns = 'minmax(140px, 28%) 1fr 48px';
      row.style.alignItems = 'center';
      row.style.gap = '10px';
      row.innerHTML = `
        <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"><span title="${name}">${name}</span></div>
        <input type="range" min="0" max="1" step="0.01" value="${val}" data-name="${name}">
        <input type="number" min="0" max="1" step="0.01" value="${val}" data-name="${name}" style="width:60px;background:#171a1f;border:1px solid #2a2f36;color:#dbe0e8;border-radius:6px;padding:4px 6px;">
      `;
      const slider = row.querySelector('input[type="range"]');
      const num = row.querySelector('input[type="number"]');

      function update(v) {
        const vv = Math.max(0, Math.min(1, Number(v)));
        slider.value = String(vv);
        num.value = String(vv);
        // 保存＆適用
        const data = loadMap(saveId).materials;
        data[name] = vv;
        saveMap(saveId, data);
        applyOpacity(scene, data);
      }
      slider.addEventListener('input', e=> update(e.target.value));
      num.addEventListener('change', e=> update(e.target.value));

      list.appendChild(row);
    });

    // 検索
    wrap.querySelector('#lm-opacity-search').oninput = e=>{
      const q = e.target.value.trim().toLowerCase();
      Array.from(list.children).forEach(row=>{
        const name = row.querySelector('span')?.textContent?.toLowerCase()||'';
        row.style.display = name.includes(q) ? '' : 'none';
      });
    };

    // リセット
    wrap.querySelector('#lm-opacity-reset').onclick = ()=>{
      const map = {};
      mats.forEach(n=> map[n]=1.0);
      saveMap(saveId, map);
      applyOpacity(scene, map);
      // 再描画
      buildUI(saveId, scene, matsMap);
    };
    // 50%
    wrap.querySelector('#lm-opacity-allhalf').onclick = ()=>{
      const map = {};
      mats.forEach(n=> map[n]=0.5);
      saveMap(saveId, map);
      applyOpacity(scene, map);
      buildUI(saveId, scene, matsMap);
    };

    // マスター
    const master = wrap.querySelector('#lm-opacity-master');
    master.value = '1';
    master.oninput = e=>{
      const v = Number(e.target.value || 1);
      const cur = loadMap(saveId).materials;
      const out = {};
      mats.forEach(n=>{
        const base = (typeof cur[n]==='number') ? cur[n] : 1;
        out[n] = +(base * v).toFixed(3);
      });
      applyOpacity(scene, out);
    };
  }

  // ===== モデルロード完了を検出してUI/適用 =====
  function initOnce() {
    const saveId = getSaveId();
    const scene = getScene();
    if (!scene) return false;

    const mats = collectMaterials(scene);
    if (mats.size === 0) return false;

    // 保存値の適用
    const saved = loadMap(saveId).materials;
    applyOpacity(scene, saved);

    // UIを差し込み
    buildUI(saveId, scene, mats);
    log('ready for saveId=', saveId, 'materials=', mats.size);
    return true;
  }

  // 1) すぐ使えるなら即初期化
  if (!initOnce()) {
    // 2) 遅延(モデルロード後)ポーリング
    let tries = 0;
    const timer = setInterval(()=>{
      if (initOnce()) { clearInterval(timer); return; }
      tries++;
      if (tries > 100) clearInterval(timer); // 約10秒
    }, 100);
  }

  // 外部からセーブID変更したいとき用
  window.LMOpacity = {
    forceRefresh() { initOnce(); },
    setSaveId(id) { window.__LM_SAVE_ID = id; initOnce(); },
    applyForCurrent() {
      const scene = getScene();
      const saved = loadMap(getSaveId()).materials;
      applyOpacity(scene, saved);
    }
  };
})();
</script>
