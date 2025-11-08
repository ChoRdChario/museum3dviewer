// material.dropdown.patch.js  v3.5
(() => {
  const TAG = '[mat-dd v3.5]';

  // ---- helpers ------------------------------------------------------------
  const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const AUTO = /^(?:Mesh)?(?:Basic|Lambert|Phong|Standard|Physical|Toon)Material$/i;

  const getSelectEl = () =>
    document.querySelector('#pm-material')
    || document.querySelector('#pm-opacity select');

  const getScene = () => window.__LM_SCENE || window.viewer?.scene || null;

  function collectMaterialNames(scene) {
    const keep = new Set();
    scene?.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) {
        const name = (m.name || '').trim();
        if (!name) continue;
        if (UUID.test(name)) continue;        // UUID っぽい名前は除外
        if (AUTO.test(name)) continue;        // Three の自動名は除外
        keep.add(name);
      }
    });
    return [...keep].sort();
  }

  function populateOnce() {
    const el = getSelectEl();
    const scene = getScene();
    if (!el || !scene) return { ok:false, reason: !el ? 'no-select' : 'no-scene', count:0 };

    const names = collectMaterialNames(scene);
    // 0件は「まだ早い」ことが多いので、この時点では lastKey を更新しない
    if (names.length === 0) {
      return { ok:false, reason:'empty', count:0 };
    }

    const key = names.join('|');
    if (window.__LM_MAT_DD_LASTKEY__ === key && el.options.length > 1) {
      // 既に同一内容が入っている
      return { ok:true, reason:'same', count: el.options.length-1 };
    }

    // UI 反映
    el.innerHTML =
      '<option value=\"\">-- Select material --</option>' +
      names.map(n => `<option value=\"${n}\">${n}</option>`).join('');
    window.__LM_MAT_DD_LASTKEY__ = key;

    console.log(TAG, 'populated', names.length);
    return { ok:true, reason:'populated', count:names.length };
  }

  // ---- main: immediate try + backoff + event hooks -----------------------
  async function ensurePopulated() {
    // 即時試行
    let r = populateOnce();
    if (r.ok || r.reason === 'no-select') return;

    // バックオフ再試行（シーンが安定するまで）
    for (let i=1; i<=8; i++) {
      await new Promise(res => setTimeout(res, 250*i));
      r = populateOnce();
      if (r.ok) return;
    }
    // ここまで来ても 0 件なら、イベント経由に委ねる
  }

  // 初期化（ページロード後すぐ）
  ensurePopulated();

  // イベント：glb 検出（フォールバック）
  window.addEventListener('lm:glb-detected', () => {
    // すぐは早いことがあるので少し後に
    setTimeout(ensurePopulated, 200);
  });

  // イベント：シーン安定化（本命）
  window.addEventListener('lm:scene-stabilized', () => {
    ensurePopulated();
  });
})();