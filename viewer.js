(function(){
  console.log('[viewer] module loaded (classic)');
  function el(q){return document.querySelector(q);}

  function ensureViewer(){
    const canvas = el('#gl') || el('canvas');
    if(!canvas) throw new Error('canvas not found');
    if(!window.THREE) throw new Error('THREE not loaded');
    if(!THREE.OrbitControls){
      console.error('THREE.OrbitControls is missing. Check script order.');
      throw new Error('OrbitControls missing');
    }

    const renderer = new THREE.WebGLRenderer({canvas, antialias:true});
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(canvas.clientWidth || canvas.parentElement.clientWidth, canvas.clientHeight || canvas.parentElement.clientHeight, false);
    renderer.setClearColor(0x0b0d11, 1);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, canvas.clientWidth/canvas.clientHeight, 0.1, 1000);
    camera.position.set(2.5, 2.0, 2.5);

    const controls = new THREE.OrbitControls(camera, canvas);
    controls.enableDamping = true;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(3,5,2);
    scene.add(dir);

    // Grid
    const grid = new THREE.GridHelper(10, 20, 0x334155, 0x1f2937);
    grid.material.opacity = 0.5;
    grid.material.transparent = true;
    scene.add(grid);

    // handle resize
    function resize(){
      const w = canvas.clientWidth || canvas.parentElement.clientWidth;
      const h = canvas.clientHeight || canvas.parentElement.clientHeight;
      if(!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w/h;
      camera.updateProjectionMatrix();
    }
    window.addEventListener('resize', resize);
    resize();

    function tick(){
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    console.log('[viewer] ready');
  }

  try{ ensureViewer(); }catch(e){
    console.error(e);
    const dbg = document.getElementById('debug');
    if(dbg) dbg.textContent = e.message;
  }
})();