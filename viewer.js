/* viewer.js — Three.js は index.html で一度だけ読み込み、ここでは global THREE を使う */

(function(){
  const log = (...a)=>console.log('[viewer]', ...a);

  let renderer, scene, camera, root, canvasHost;

  function ensureViewer(){
    // index.html に用意した #viewer を必ず参照
    canvasHost = document.getElementById('viewer');
    if(!canvasHost) throw new Error('[viewer] #viewer not found');
    const w = canvasHost.clientWidth;
    const h = canvasHost.clientHeight || window.innerHeight;

    if(!renderer){
      renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
      renderer.setPixelRatio(window.devicePixelRatio);
      canvasHost.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(50, w/h, 0.1, 2000);
      camera.position.set(0, 1, 3);

      const light = new THREE.DirectionalLight(0xffffff, 1.1);
      light.position.set(1,2,3);
      scene.add(light);
      scene.add(new THREE.AmbientLight(0x404040));

      root = new THREE.Group();
      scene.add(root);

      animate();
      window.addEventListener('resize', resize);
    }
    resize();
  }

  function resize(){
    if(!canvasHost || !renderer || !camera) return;
    const w = canvasHost.clientWidth || window.innerWidth - 360;
    const h = canvasHost.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function animate(){
    requestAnimationFrame(animate);
    renderer.render(scene, camera);
  }

  // 公開API（既存 app_boot.js が参照）
  window.Viewer = {
    ensure: ensureViewer,
    get scene(){ return scene; },
    get root(){ return root; },
    loadGLB: async function(url){
      await this.ensure();
      // GLBローダは後段で（既存の実装があればそちらを使用）
      log('loadGLB', url);
    }
  };
})();
