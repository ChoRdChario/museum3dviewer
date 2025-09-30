
/**
 * viewer_ortho_fix.js
 * Phase1: 平行投影(OrthographicCamera)のアスペクト歪み修正。
 * 使い方: viewer 初期化後にこの関数を呼び出して resize フックを差し込む。
 */
(function(){
  if (!window.LMY) window.LMY = {};
  const L = window.LMY;

  /**
   * camera: THREE.OrthographicCamera
   * width/height: canvas size in CSS pixels
   */
  function applyOrthoFrustum(camera, width, height) {
    if (!camera || !camera.isOrthographicCamera) return;
    const aspect = Math.max(0.0001, width / Math.max(1, height));
    const v = (camera.top !== undefined) ? Math.abs(camera.top) : 1;
    camera.left   = -v * aspect;
    camera.right  =  v * aspect;
    camera.top    =  v;
    camera.bottom = -v;
    camera.updateProjectionMatrix();
  }

  /**
   * viewer: { renderer, camera, canvas, resize:Function? }
   * options.keepOriginalResize: 既存の resize があれば併用
   */
  L.hookOrthoResize = function(viewer, options={}) {
    const keep = !!options.keepOriginalResize;
    const originalResize = viewer.resize?.bind(viewer);
    viewer.resize = function(){
      // 1) 既存 resize（あれば）
      if (keep && originalResize) originalResize();
      // 2) Ortho の場合は frustum を再計算
      const canvas = viewer.canvas || viewer.renderer?.domElement;
      const cam = viewer.camera;
      if (!canvas || !cam) return;
      const width = canvas.clientWidth || canvas.width || 1;
      const height = canvas.clientHeight || canvas.height || 1;
      if (cam.isOrthographicCamera) {
        applyOrthoFrustum(cam, width, height);
      }
    };
    // 初回も一度適用しておく
    try { viewer.resize(); } catch(e){ console.warn("[LMY] hookOrthoResize initial resize failed", e); }
  };
})();
