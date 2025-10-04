// features/fetch_glb_tap.js
(function(){
  const origFetch = window.fetch;
  if (!origFetch) return console.warn('[tap] no fetch available');

  function looksLikeDriveGlb(url, res){
    try {
      const u = String(url);
      if (!(u.includes('/drive/v3/files/') && u.includes('alt=media'))) return false;
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      return ct.includes('model/gltf-binary') || ct.includes('application/octet-stream');
    } catch(e){ return false; }
  }

  window.fetch = async function(...args){
    const res = await origFetch.apply(this, args);
    try {
      const [url] = args;
      if (looksLikeDriveGlb(url, res)) {
        const clone = res.clone();
        clone.blob().then(blob=>{
          const name = 'drive.glb';
          dispatchEvent(new CustomEvent('lmy:auto-glb-blob', { detail: { blob, name } }));
          console.log('[tap] GLB tapped from fetch', name, blob.size);
        }).catch(()=>{});
      }
    } catch(e){ /* ignore */ }
    return res;
  };
  console.log('[tap] fetch tapped');
})();