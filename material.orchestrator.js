// material.orchestrator.js (minimal anchoring only)
const TAG = '[mat-orch:min]';
const log = (...a)=>console.log(TAG, ...a);
const warn = (...a)=>console.warn(TAG, ...a);

function moveRogueChildrenOut() {
  const tabBtn = document.getElementById('tab-material');
  if (!tabBtn) return;
  const rogues = tabBtn.querySelectorAll('#materialSelect, #opacityRange, select, input[type="range"]');
  rogues.forEach(n => n.remove()); // 見出し配下の残骸は物理的に排除
}

function findUI() {
  moveRogueChildrenOut();

  const panel = document.getElementById('panel-material');
  if (!panel) { warn('panel missing'); return null; }

  const sel = panel.querySelector('#materialSelect');
  const rng = panel.querySelector('#opacityRange');

  if (!sel || !rng) {
    warn('select present but invisible (collapsed?)');
    return null;
  }
  return { panel, sel, rng };
}

(function init(){
  let tries = 0;
  (function tick(){
    const ui = findUI();
    if (ui) {
      log('UI in pane', ui);
      // ここでは“場所を正す”だけ。値の投入やイベント接続は既存側に任せる。
      return;
    }
    if (++tries > 20) return; // 打ち切り
    setTimeout(tick, 250);
  })();
})();
