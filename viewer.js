
// viewer.js — shim patch to provide loadByInput() expected by ui.js
// Replace your existing viewer.js with this content.

(function(){
  const W = (typeof window !== 'undefined') ? window : globalThis;
  W.app = W.app || {};
  app.viewer = app.viewer || {};

  function log(...args){ try{ console.log('[viewer/shim]', ...args);}catch(e){} }

  // ready helpers
  if (!app.viewer.readyCbs) app.viewer.readyCbs = [];
  if (!app.viewer.onceReady) {
    app.viewer.onceReady = function(cb){
      if (typeof app.viewer.isReady === 'function' ? app.viewer.isReady() : !!app.viewer._ready){
        try{ cb(); }catch(e){ console.error(e); }
      }else{
        app.viewer.readyCbs.push(cb);
      }
    };
  }
  if (!app.viewer._emitReady) {
    app.viewer._emitReady = function(){
      app.viewer._ready = true;
      const cbs = app.viewer.readyCbs || [];
      while(cbs.length){ try{ (cbs.shift())(); }catch(e){ console.error(e); } }
      document.dispatchEvent(new CustomEvent('lmy:viewer-ready'));
    };
  }

  // helpers
  function normalizeDriveIdFromInputFallback(s){
    if (!s) return null;
    s = String(s).trim();
    const m = s.match(/(?:\/d\/|id=)([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
    return null;
  }
  async function fetchDriveArrayBuffer(id){
    if (typeof W.fetchDriveFileAsArrayBuffer === 'function'){
      return await W.fetchDriveFileAsArrayBuffer(id);
    }
    const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return await res.arrayBuffer();
  }

  // core arraybuffer path
  app.viewer.loadArrayBuffer = app.viewer.loadArrayBuffer || (async function(ab){
    if (typeof app.viewer.loadGLBFromArrayBuffer === 'function'){
      return await app.viewer.loadGLBFromArrayBuffer(ab);
    }
    if (typeof THREE === 'undefined'){
      throw new Error('THREE is not defined; viewer core must expose loadGLBFromArrayBuffer');
    }
    if (!app.viewer._scene || !app.viewer._renderer || !app.viewer._camera){
      app.viewer._scene = app.viewer._scene || new THREE.Scene();
      const w = (W.innerWidth||1280), h=(W.innerHeight||720);
      app.viewer._camera = app.viewer._camera || new THREE.PerspectiveCamera(45, w/h, 0.1, 1000);
      app.viewer._camera.position.set(0,0,5);
      const canvas = document.getElementById('stage');
      app.viewer._renderer = app.viewer._renderer || new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
      app.viewer._renderer.setSize(w,h,false);
      const light = new THREE.DirectionalLight(0xffffff, 1.0);
      light.position.set(1,1,1); app.viewer._scene.add(light);
      (function loop(){
        requestAnimationFrame(loop);
        app.viewer._renderer.render(app.viewer._scene, app.viewer._camera);
      })();
    }
    let GLTFLoader = (W.THREE && W.THREE.GLTFLoader) ? W.THREE.GLTFLoader : null;
    if (!GLTFLoader && W.__GLTFLoaderModule) GLTFLoader = W.__GLTFLoaderModule.GLTFLoader;
    if (!GLTFLoader){
      try{
        const mod = await import('/museum3dviewer/lib/GLTFLoader.js');
        GLTFLoader = mod.GLTFLoader || mod.default;
      }catch(e){
        log('failed to import GLTFLoader module', e);
      }
    }
    if (!GLTFLoader) throw new Error('GLTFLoader not available');
    const loader = new GLTFLoader();
    const blob = new Blob([ab], {type:'model/gltf-binary'});
    const url = URL.createObjectURL(blob);
    await new Promise((resolve, reject)=>{
      loader.load(url, (gltf)=>{
        try{
          const sc = app.viewer._scene;
          (sc.children.slice() || []).forEach(ch=>{ if (ch.type!=='DirectionalLight' && ch.type!=='AmbientLight') sc.remove(ch); });
          sc.add(gltf.scene);
          URL.revokeObjectURL(url);
          resolve();
        }catch(err){ reject(err); }
      }, undefined, reject);
    });
    app.viewer._emitReady();
  });

  if (typeof app.viewer.loadByInput !== 'function'){
    app.viewer.loadByInput = async function(input){
      log('loadByInput', input);
      const id = (typeof W.normalizeDriveIdFromInput === 'function')
        ? W.normalizeDriveIdFromInput(input)
        : normalizeDriveIdFromInputFallback(input);
      if (!id) throw new Error('empty file id/url');
      const ab = await fetchDriveArrayBuffer(id);
      await app.viewer.loadArrayBuffer(ab);
      return true;
    };
  }

  if (typeof app.viewer.loadFromUrl !== 'function'){
    app.viewer.loadFromUrl = async function(url){
      const res = await fetch(url);
      if (!res.ok) throw new Error('fetch failed: ' + res.status);
      const ab = await res.arrayBuffer();
      await app.viewer.loadArrayBuffer(ab);
    };
  }

  log('shim ready');
})();
