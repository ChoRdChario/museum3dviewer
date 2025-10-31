/*! viewer.bridge.module.js (robust scene + materials bridge) */
(function(){
  var NS='[viewer-bridge]';
  function log(){ try{ console.log.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }
  function warn(){ try{ console.warn.apply(console, [NS].concat([].slice.call(arguments))); }catch(e){} }

  if (window.viewerBridge && window.viewerBridge.__v >= 2) { log('already installed'); return; }

  // --- find scene (very robust) ---------------------------------------------
  function findSceneNow(){
    try{
      var w = window;
      // direct candidates
      var cands = [
        w.__lm_getScene && w.__lm_getScene(),
        w.__sceneProbe && w.__sceneProbe.scene,
        w.__lm_viewer && w.__lm_viewer.scene,
        w.viewer && w.viewer.scene,
        w.viewer3d && w.viewer3d.scene,
        w.__LM && w.__LM.scene
      ].filter(Boolean);
      for (var i=0;i<cands.length;i++){ var s=cands[i]; if (s && s.isScene) return s; }

      // scan window objects (fallback)
      var keys = Object.keys(w);
      for (var j=0;j<keys.length;j++){
        var v = w[keys[j]];
        if (!v || typeof v!=='object') continue;
        if (v.isScene) return v;
        if (v.scene && v.scene.isScene) return v.scene;
      }
    }catch(e){}
    return null;
  }

  // hook THREE.Scene to capture when constructed / first add()
  function armSceneHook(){
    if (window.__vbSceneHooked) return;
    var T = window.THREE;
    if (!T || !T.Scene || !T.Scene.prototype) return;
    window.__vbSceneHooked = true;
    try{
      var add = T.Scene.prototype.add;
      T.Scene.prototype.add = function(){
        try{ window.__sceneProbe = { scene:this, at: Date.now() }; }catch(e){}
        return add.apply(this, arguments);
      };
      log('scene hook armed');
    }catch(e){ warn('scene hook failed', e); }
  }

  // --- list materials from scene -------------------------------------------
  function listMaterialsFromScene(scene){
    if (!scene) return [];
    var set = {};
    function badType(m){
      var t = (m && m.type) || '';
      if (/Depth|Distance|Shadow|Sprite|Shader/.test(t)) return true;
      return !!(m && (m.isLineBasicMaterial || m.isLineDashedMaterial || m.isPointsMaterial));
    }
    function nameOf(m){
      if (!m) return '';
      var n = (m.name || '').trim();
      if (!n || /^material\.\d+$/.test(n)) return ''; // placeholder/empty excluded
      return n;
    }
    function isOverlayObj(o){
      return !!(o && (o.type==='Sprite' || (o.name && o.name.indexOf('__LM_')===0) || (o.userData && o.userData.__lmOverlay)));
    }
    try{
      scene.traverse(function(obj){
        if (isOverlayObj(obj)) return;
        var mat = obj && obj.material;
        function push(m){ if (!m || badType(m)) return; var n=nameOf(m); if (n) set[n]=true; }
        if (!mat) return;
        if (Array.isArray(mat)) mat.forEach(push); else push(mat);
      });
    }catch(e){ warn('traverse error', e); }
    return Object.keys(set);
  }

  // --- light watcher: poll until scene is visible once ----------------------
  var cachedScene = null;
  function getScene(){
    if (cachedScene && cachedScene.isScene) return cachedScene;
    var s = findSceneNow();
    if (s) cachedScene = s;
    return s;
  }
  function listMaterials(){
    var s = getScene();
    if (!s) return [];
    return listMaterialsFromScene(s);
  }

  function armSceneWatcher(){
    if (window.__vbSceneWatch) return;
    window.__vbSceneWatch = true;
    armSceneHook();
    var ticks = 0;
    var it = setInterval(function(){
      if (getScene()) { log('scene captured via poll'); clearInterval(it); return; }
      ticks++;
      if (ticks % 5 === 0) warn('scene not found during bridge watch (non-fatal)');
      if (ticks > 150) clearInterval(it);
    }, 200);
  }

  // expose bridge API
  window.viewerBridge = {
    __v: 2,
    getScene: getScene,
    listMaterials: listMaterials
  };
  log('bridge installed');
  armSceneWatcher();
})();