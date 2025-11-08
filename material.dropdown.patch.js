/* material.dropdown.patch.js v3.5.2
 * - 確実読込：HTML へ 1 行追加するだけ
 * - 順序無依存：イベント/再試行で自己回復
 * - フィルタ済み：UUID名やThreeの既定名は除外
 * - グローバル公開：__LM_MAT_DD_VERSION__, __LM_materialDropdownPopulate()
 */
(() => {
  const TAG = '[mat-dd v3.5.2]';
  if (window.__LM_MAT_DD_VERSION__) {
    console.debug(TAG, 'already loaded');
    return;
  }
  window.__LM_MAT_DD_VERSION__ = '3.5.2';

  const UUID_RE = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  const AUTO_RE = /^(?:Mesh)?(?:Basic|Lambert|Phong|Standard|Physical|Toon)Material$/i;

  const pickDropdown = () =>
    document.querySelector('#pm-material')
    || document.querySelector('#pm-opacity select')
    || document.querySelector('[data-lm="mat-select"]')
    || document.querySelector('section.lm-panel-material select');

  const getScene = () => window.__LM_SCENE || window.viewer?.scene || null;

  function collectMaterialNames(scene) {
    const keep = new Set();
    scene?.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const arr = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of arr) {
        const name = (m.name || '').trim();
        if (!name) continue;                 // 無名は除外
        if (UUID_RE.test(name)) continue;    // UUID名は除外
        if (AUTO_RE.test(name)) continue;    // Three既定名は除外
        keep.add(name);
      }
    });
    return Array.from(keep).sort();
  }

  let inflight = false;

  async function populateOnce() {
    if (inflight) return false;
    inflight = true;
    try {
      const dd = pickDropdown();
      const scene = getScene();
      if (!dd || !scene) return false;

      const names = collectMaterialNames(scene);
      if (!names.length) return false;

      // 変更がないならスキップ（ちらつき防止）
      const curr = Array.from(dd.options).map(o => o.value);
      const next = [''].concat(names);
      const same = curr.length === next.length && curr.every((v,i)=>v===next[i]);
      if (same) return true;

      dd.innerHTML =
        '<option value="">-- Select material --</option>' +
        names.map(n => `<option value="${n}">${n}</option>`).join('');

      // 監査用属性
      dd.dataset.lmMatCount = String(names.length);
      dd.dataset.lmMatStamp = String(Date.now());

      console.debug(TAG, 'populated', names.length);
      window.dispatchEvent(new CustomEvent('lm:materials-populated', {
        detail: { count: names.length, names }
      }));
      return true;
    } finally {
      inflight = false;
    }
  }

  // 露出：手動トリガ可能
  window.__LM_materialDropdownPopulate = async () => {
    const ok = await populateOnce();
    if (!ok) console.debug(TAG, 'deferred (conditions not ready)');
    return ok;
  };

  // 自動実行：イベント＋指数バックオフ
  function armAuto() {
    // 主要イベントで都度試行
    ['DOMContentLoaded', 'load', 'lm:glb-detected', 'lm:scene-stabilized']
      .forEach(ev => window.addEventListener(ev, () => populateOnce()));

    // バックオフ再試行（最大 8 回）
    (async () => {
      for (let i = 1; i <= 8; i++) {
        const ok = await populateOnce();
        if (ok) break;
        await new Promise(r => setTimeout(r, 250 * i)); // 250,500,750,...
      }
    })();
  }

  armAuto();
  console.debug(TAG, 'armed');
})();
