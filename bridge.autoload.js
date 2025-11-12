// Auto-load and wire the GLB button bridge safely
(function(){
  const onReady = () => {
    import('./glb.btn.bridge.v3.js').then(() => {
      console.log('[autoload] glb.bridge loaded');
    }).catch(e => {
      console.error('[autoload] failed to import glb.btn.bridge.v3.js', e);
    });
  };
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    onReady();
  } else {
    document.addEventListener('DOMContentLoaded', onReady, { once: true });
  }
})();