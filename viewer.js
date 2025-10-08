// viewer.js
// Minimal THREE.js viewer with OrbitControls and GLB loading (global THREE).

(function(){
  let renderer, scene, camera, controls;
  let host, canvas, statusEl;
  let current;
  let grid;

  function logStatus(msg){
    if(statusEl) statusEl.textContent = msg;
    console.log('[viewer]', msg);
  }

  function ensureViewer(){
    if(renderer) return renderer;
    host = document.getElementById('viewer-host');
    canvas = document.getElementById('viewer-canvas');
    statusEl = document.getElementById('viewer-status');
    if(!host || !canvas) throw new Error('[viewer] canvas/host missing');

    // renderer
    renderer = new THREE.WebGLRenderer({canvas, antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    resize();
    window.addEventListener('resize', resize);

    // scene & camera
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0d12);
    camera = new THREE.PerspectiveCamera(60, host.clientWidth/host.clientHeight, 0.1, 2000);
    camera.position.set(2.5, 1.5, 2.5);

    // grid & light
    grid = new THREE.GridHelper(10, 10, 0x2a2f3a, 0x1b1f29);
    scene.add(grid);

    const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
    scene.add(hemi);

    // controls
    controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    // tick
    (function animate(){
      requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    })();

    logStatus('ready');
    return renderer;
  }

  function resize(){
    if(!renderer || !host) return;
    const w = host.clientWidth, h = host.clientHeight;
    renderer.setSize(w, h, false);
    if(camera){
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
  }

  async function loadGLB(url){
    ensureViewer();
    if(current){
      scene.remove(current);
      current.traverse?.(obj=>{
        if(obj.isMesh){
          obj.geometry?.dispose?.();
          obj.material?.dispose?.();
        }
      });
      current = null;
    }
    const {GLTFLoader} = await import('https://unpkg.com/three@0.150.1/examples/jsm/loaders/GLTFLoader.js');
    const loader = new GLTFLoader();
    return new Promise((resolve, reject)=>{
      loader.load(url, (gltf)=>{
        current = gltf.scene;
        scene.add(current);
        // frame
        const box = new THREE.Box3().setFromObject(current);
        const size = box.getSize(new THREE.Vector3()).length();
        const center = box.getCenter(new THREE.Vector3());
        controls.target.copy(center);
        camera.position.copy(center.clone().add(new THREE.Vector3(size, size, size).multiplyScalar(0.2)));
        controls.update();
        logStatus('loaded');
        resolve(current);
      }, (e)=>{
        if(e.total) logStatus(`loading ${(e.loaded/e.total*100).toFixed(0)}%`);
      }, (err)=>{
        logStatus('load error');
        reject(err);
      });
    });
  }

  function setPinColor(hex){
    // placeholder to reflect color choice in console
    console.log('[viewer] color set', hex);
  }

  // Expose minimal API
  window.Viewer = { ensureViewer, loadGLB, setPinColor };
})();
