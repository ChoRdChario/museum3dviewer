// viewer_api_shim.js — normalize viewer API at runtime
(function(){
  function install(){
    const app = window.app;
    if (!app || !app.viewer) return false;
    const v = app.viewer;

    // 1) Ensure loadGLB(arrayBuffer) exists
    if (typeof v.loadGLB !== 'function'){
      v.loadGLB = async function(arrayBuffer){
        if (!(arrayBuffer instanceof ArrayBuffer)) throw new Error('loadGLB expects ArrayBuffer');
        // Possible native funcs
        if (typeof v.loadGLBFromArrayBuffer === 'function'){
          return await v.loadGLBFromArrayBuffer(arrayBuffer);
        }
        if (typeof v.loadFromArrayBuffer === 'function'){
          return await v.loadFromArrayBuffer(arrayBuffer);
        }
        // Blob URL fallback
        const blob = new Blob([arrayBuffer], {type:'model/gltf-binary'});
        const url = URL.createObjectURL(blob);
        try{
          if (typeof v.loadGLBUrl === 'function') return await v.loadGLBUrl(url);
          if (typeof v.loadUrl === 'function')    return await v.loadUrl(url);
          if (typeof v.load === 'function')       return await v.load(url);
          // As a last resort, try posting a custom event many viewers listen for
          window.dispatchEvent(new CustomEvent('lmy:load-url', {detail:{url}}));
        }finally{
          setTimeout(()=> URL.revokeObjectURL(url), 0);
        }
        throw new Error('No viewer method to load URL');
      };
    }

    // 2) Optional: uniqueMaterials getter
    if (typeof v.getMaterials !== 'function'){
      v.getMaterials = function(){
        const mats = new Set();
        const root = v.scene || v.getScene?.();
        if (!root) return [];
        root.traverse?.((obj)=>{
          const m = obj.material;
          if (m){
            if (Array.isArray(m)) m.forEach(mm=> mats.add(mm));
            else mats.add(m);
          }
        });
        return Array.from(mats);
      };
    }

    // 3) No-op stubs to avoid "is not a function" when UI fires early
    ['setHSL','setOpacity','setUnlit','setDoubleSide','setWhiteKey','setWhiteKeyEnabled']
      .forEach(fn=>{ if (typeof v[fn] !== 'function'){ v[fn] = ()=>{}; } });

    return true;
  }
  // Try now, and on viewer-ready/model-loaded
  if (!install()){
    const tryLater = ()=> install() && (window.removeEventListener('lmy:viewer-ready', tryLater), window.removeEventListener('lmy:model-loaded', tryLater), document.removeEventListener('DOMContentLoaded', tryLater));
    window.addEventListener('lmy:viewer-ready', tryLater);
    window.addEventListener('lmy:model-loaded', tryLater);
    document.addEventListener('DOMContentLoaded', tryLater);
  }
})();
