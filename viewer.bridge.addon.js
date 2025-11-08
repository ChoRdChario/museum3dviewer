/* viewer.bridge.addon.js (safe augment) */
(() => {
  const TAG='[viewer-bridge:addon]';
  const log=(...a)=>console.log(TAG,...a);
  window.viewerBridge = window.viewerBridge || {};

  if (!window.viewerBridge.getMaterialKeys){
    window.viewerBridge.getMaterialKeys = async function(){
      const names = new Set();
      try{
        const scene = window.viewer?.scene;
        scene?.traverse?.(obj=>{
          const m = obj.material;
          if (!m) return;
          const put = (mm)=> mm?.name && names.add(mm.name);
          if (Array.isArray(m)) m.forEach(put); else put(m);
        });
      }catch(e){ console.warn(TAG, 'getMaterialKeys failed', e); }
      const arr = [...names].sort();
      log('getMaterialKeys ->', arr);
      return arr;
    };
  }

  if (!window.viewerBridge.setMaterialOpacity){
    window.viewerBridge.setMaterialOpacity = function(key, value){
      try{
        const v = Math.max(0, Math.min(1, +value || 0));
        const scene = window.viewer?.scene;
        scene?.traverse?.(obj=>{
          const m = obj.material;
          if (!m) return;
          const apply = (mm)=>{
            if (mm?.name !== key) return;
            mm.transparent = v < 1 || mm.transparent;
            mm.opacity = v;
            mm.needsUpdate = true;
          };
          if (Array.isArray(m)) m.forEach(apply); else apply(m);
        });
        log('setMaterialOpacity', key, value);
      }catch(e){ console.warn(TAG, 'setMaterialOpacity failed', e); }
    };
  }
})();