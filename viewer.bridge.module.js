// viewer.bridge.module.js
// Tiny bridge: 「キャンバス準備OK」と「モデル実体が載った」をUI側へ確実に通知する
// - lm:scene-ready : __LM_SCENE が使えるようになったら一度だけ
// - lm:model-ready : シーンに最初の Mesh が出現したら一度だけ

(() => {
  const log = (...a) => console.log('[viewer-bridge]', ...a);

  // 1) scene-ready: __LM_SCENE が見えるようになったタイミング
  (function watchSceneReadyOnce() {
    let fired = false;
    const iv = setInterval(() => {
      if (fired) return clearInterval(iv);
      const s = window.__LM_SCENE;
      if (s) {
        fired = true;
        clearInterval(iv);
        document.dispatchEvent(new CustomEvent('lm:scene-ready', { detail: { scene: s } }));
        log('lm:scene-ready dispatched (bridge)');
      }
    }, 120);
  })();

  // 2) model-ready: シーンに最初の Mesh が現れたタイミング
  (function watchModelReadyOnce() {
    let fired = false;
    const iv = setInterval(() => {
      if (fired) return clearInterval(iv);
      const s = window.__LM_SCENE;
      let hasMesh = false;
      s?.traverse?.((o) => { if (o.isMesh) hasMesh = true; });
      if (hasMesh) {
        fired = true;
        clearInterval(iv);
        document.dispatchEvent(new CustomEvent('lm:model-ready', { detail: { scene: s } }));
        log('lm:model-ready dispatched');
      }
    }, 200);
  })();
})();
