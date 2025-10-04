// features/viewer_bootstrap.js
import { createViewerAdapter } from '../viewer/adapter.three.js';
(function(){
  const canvas = document.getElementById('lmy-canvas');
  if(!canvas){ console.warn('[viewer_bootstrap] #lmy-canvas not found'); return; }
  const viewer = createViewerAdapter(canvas);
  window.__LMY_viewer = viewer;
  console.log('[viewer_bootstrap] viewer ready');
})();
