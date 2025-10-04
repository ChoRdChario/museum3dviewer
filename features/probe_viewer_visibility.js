// features/probe_viewer_visibility.js
(function(){
  function markCanvas() {
    const cvs = Array.from(document.querySelectorAll('canvas'));
    cvs.forEach((c,i)=>{
      c.style.outline = '3px solid #ff0044';
      c.style.background = c.style.background || '#0f0f0f';
      const r = c.getBoundingClientRect();
      console.log(`[probe] canvas#${i} ${Math.round(r.width)}x${Math.round(r.height)} vis=${getComputedStyle(c).visibility} disp=${getComputedStyle(c).display} z=${c.style.zIndex||'-'}`);
    });
    if (!cvs.length) console.warn('[probe] no canvas found');
  }
  function markHosts() {
    ['#viewer-host','#stage','#app','#container'].forEach(sel=>{
      const el = document.querySelector(sel);
      if (!el) return;
      el.style.outline = '2px dashed #44ccff';
      const r = el.getBoundingClientRect();
      console.log(`[probe] host ${sel} ${Math.round(r.width)}x${Math.round(r.height)} disp=${getComputedStyle(el).display} pos=${getComputedStyle(el).position} z=${getComputedStyle(el).zIndex}`);
    });
  }
  function ensureDemo() {
    if (window.__LMY_DEMO) return;
    const existing = document.querySelector('canvas');
    if (existing) return; // キャンバスがあるなら無理に追加しない
    const host = document.querySelector('#viewer-host') || (function(){
      const d=document.createElement('div'); d.id='viewer-host';
      d.style.cssText='position:fixed;inset:0;z-index:0;background:#0f0f0f';
      document.body.appendChild(d); return d;
    })();
    Promise.all([
      import('https://unpkg.com/three@0.160.0/build/three.module.js'),
      import('https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
    ]).then(([THREE, {OrbitControls}])=>{
      const renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
      renderer.setSize(host.clientWidth||innerWidth, host.clientHeight||innerHeight, false);
      host.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50,(host.clientWidth||innerWidth)/(host.clientHeight||innerHeight),0.01,1000);
      camera.position.set(2,1.5,3);
      const ctl = new OrbitControls(camera, renderer.domElement);
      scene.add(new THREE.HemisphereLight(0xffffff,0x222222,1));
      const geo = new THREE.BoxGeometry(1,1,1);
      const mat = new THREE.MeshStandardMaterial({ color:0x55ccff, roughness:0.6, metalness:0.1 });
      const mesh = new THREE.Mesh(geo,mat); scene.add(mesh);
      const grid = new THREE.GridHelper(10,10,0x444444,0x222222); scene.add(grid);
      function fit(){ const w=host.clientWidth||innerWidth, h=host.clientHeight||innerHeight; renderer.setSize(w,h,false); camera.aspect=w/h; camera.updateProjectionMatrix(); }
      addEventListener('resize', fit); fit();
      (function loop(){ requestAnimationFrame(loop); mesh.rotation.y += 0.01; ctl.update(); renderer.render(scene,camera); })();
      window.__LMY_DEMO = true;
      console.log('[probe] demo viewer mounted');
    }).catch(e=>console.warn('[probe] demo mount failed', e));
  }
  window.addEventListener('load', ()=>{
    setTimeout(()=>{ markHosts(); markCanvas(); ensureDemo(); }, 0);
  });
})();
