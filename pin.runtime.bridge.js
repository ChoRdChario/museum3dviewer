// pin.runtime.bridge.js  vA0.2 (viewerブリッジ自動バインド & リハイドレート)
console.log('[pin-bridge] armed');

const PinBridge = (() => {
  let viewer = null;
  let store  = null; // UI 側が生やす in-memory ストアを後で受け取る

  // UI から注入される想定 (caption.ui.controller.js 側で setStore を呼ぶ)
  function setStore(ref){
    store = ref;
    tryRehydrate();
  }

  // viewer ブリッジ確定
  function setViewerBridge(v){
    viewer = v || null;
    console.log('[pin-bridge] viewer bound =', !!viewer);
    tryRehydrate();
  }

  // 既存キャプションをピンとして反映
  function tryRehydrate(){
    if (!viewer || !store || !Array.isArray(store.items)) return;
    if (typeof viewer.clearPins === 'function') viewer.clearPins();
    for (const it of store.items){
      if (!it || !it.id) continue;
      const pos = it.world || it.position || null;   // 旧版互換
      const col = it.color  || it.pinColor || '#f5c16c';
      if (typeof viewer.addPinMarker === 'function'){
        viewer.addPinMarker({ id: it.id, position: pos, color: col, data: it });
      }
    }
  }

  // 単発追加（UI 側から呼ばれる）
  function addPin(item){
    if (!viewer || !item) return;
    const pos = item.world || item.position || null;
    const col = item.color || item.pinColor || '#f5c16c';
    viewer.addPinMarker?.({ id:item.id, position:pos, color:col, data:item });
  }

  // 選択状態
  function setSelected(id){
    viewer?.setPinSelected?.(id);
  }

  // 初期化：イベントを拾って自動で viewer をバインド
  function init(){
    // 1) 既にグローバルがあれば掴む
    if (window.__lm_viewer_bridge) setViewerBridge(window.__lm_viewer_bridge);

    // 2) 後から生える場合
    window.addEventListener('lm:viewer-bridge-ready', () => {
      setViewerBridge(window.__lm_viewer_bridge || null);
    });

    // 3) シーン準備イベントでも再試行
    document.addEventListener('lm:scene-ready', () => {
      if (!viewer) setViewerBridge(window.__lm_viewer_bridge || null);
      tryRehydrate();
    });
  }

  init();

  return { setStore, setViewerBridge, tryRehydrate, addPin, setSelected };
})();

window.__LM_PIN_BRIDGE = PinBridge;
export default PinBridge;
