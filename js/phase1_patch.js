// Phase 1 patch: camera mapping, ortho zoom, color key fix & opacity handling
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

function getViewerProto(){
  const gv = (window.viewer && Object.getPrototypeOf(window.viewer)) || (window.Viewer && window.Viewer.prototype);
  return gv || {};
}

// --- shader inject for color key ---
function applyColorKeyToMaterial(mat, cfg){
  if(!mat) return;
  const hasMap = !!mat.map;
  const wantKey = (cfg.whiteKey || cfg.blackKey) && hasMap;
  mat.alphaTest = 0.0;
  mat.transparent = (cfg.opacity < 1.0) || wantKey;
  mat.opacity = cfg.opacity;
  mat.depthWrite = !mat.transparent;
  if(!mat.userData) mat.userData = {};

  if(!wantKey){
    if(mat.userData.__lmy_restore) { try { mat.onBeforeCompile = mat.userData.__lmy_restore; } catch(_){} }
    else { mat.onBeforeCompile = (shader)=>{}; }
    mat.needsUpdate = true;
    return;
  }

  const injectKeyBlock = `
    uniform float LMY_WHITE_THR;
    uniform float LMY_BLACK_THR;
    uniform bool  LMY_USE_WHITE;
    uniform bool  LMY_USE_BLACK;
  `;

  function inject(shader){
    shader.uniforms.LMY_WHITE_THR = { value: cfg.whiteThr ?? 0.95 };
    shader.uniforms.LMY_BLACK_THR = { value: cfg.blackThr ?? 0.05 };
    shader.uniforms.LMY_USE_WHITE = { value: !!cfg.whiteKey };
    shader.uniforms.LMY_USE_BLACK = { value: !!cfg.blackKey };
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `${injectKeyBlock}\nvoid main() {`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
      vec4 sampledDiffuseColor = texture2D( map, vMapUv );
      diffuseColor *= sampledDiffuseColor;
      float keyAlpha = 1.0;
      if(LMY_USE_WHITE){
        float distW = distance(sampledDiffuseColor.rgb, vec3(1.0));
        float aW = smoothstep(LMY_WHITE_THR, LMY_WHITE_THR - 0.1, 1.0 - distW);
        keyAlpha = min(keyAlpha, aW);
      }
      if(LMY_USE_BLACK){
        float distB = distance(sampledDiffuseColor.rgb, vec3(0.0));
        float aB = smoothstep(LMY_BLACK_THR, LMY_BLACK_THR - 0.1, 1.0 - distB);
        keyAlpha = min(keyAlpha, aB);
      }
      diffuseColor.a *= keyAlpha;
    #endif`);
  }

  if(!mat.userData.__lmy_restore){
    mat.userData.__lmy_restore = mat.onBeforeCompile;
  }
  mat.onBeforeCompile = function(shader){
    if(typeof mat.userData.__lmy_restore === 'function'){
      try { mat.userData.__lmy_restore(shader); } catch(_){}
    }
    inject(shader);
  };
  mat.needsUpdate = true;
}

function applyMaterialRulesToScene(root, cfg){
  root.traverse(obj=>{
    if(obj.isMesh && obj.material){
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for(const m of mats){
        if(cfg.unlit && !(m instanceof THREE.MeshBasicMaterial)){
          const basic = new THREE.MeshBasicMaterial({
            map: m.map || null,
            color: m.color ? m.color.clone() : new THREE.Color(0xffffff),
            side: cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
            transparent: m.transparent,
            opacity: m.opacity,
          });
          obj.material = basic;
          applyColorKeyToMaterial(basic, cfg);
        }else{
          m.side = cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
          applyColorKeyToMaterial(m, cfg);
        }
      }
    }
  });
}

// --- Camera remap ---
(function(){
  const proto = getViewerProto();
  const _orig = proto.setCameraPreset;
  if(!_orig) return;
  proto.setCameraPreset = function(dir){
    const remap = { front:'right', back:'left', left:'back', right:'front', top:'top', bottom:'bottom' };
    const mapped = remap[dir] || dir;
    return _orig.call(this, mapped);
  };
})();

// --- Ortho zoom ---
(function(){
  const proto = getViewerProto();
  const _orig = proto.toggleOrtho || proto.setOrtho;
  if(!_orig) return;
  proto.toggleOrtho = function(on){
    const r = _orig.call(this, on);
    try{
      const controls = this.controls || this.orbit || this.orbitControls;
      if(controls){
        controls.enableZoom = true;
        controls.zoomToCursor = true;
        controls.enableDamping = true;
        controls.update && controls.update();
      }
      const cam = this.camera || this.cam;
      if(on && cam && cam.isOrthographicCamera){
        if(!cam.zoom || cam.zoom < 0.1) cam.zoom = 1.0;
        cam.updateProjectionMatrix();
      }
    }catch(e){ console.warn('[LociMyu patch] toggleOrtho post-config failed', e); }
    return r;
  };
})();

// --- Material config extend ---
(function(){
  const proto = getViewerProto();
  const _orig = proto.setMaterialConfig;
  proto.setMaterialConfig = function(cfg){
    const merged = Object.assign({}, this.currentMaterialCfg||{
      opacity: 1.0, doubleSided:false, unlit:false, whiteKey:false, whiteThr:0.95, blackKey:false, blackThr:0.05
    }, cfg||{});
    const r = _orig ? _orig.call(this, merged) : undefined;
    this.currentMaterialCfg = merged;
    try{
      const scene = this.scene || this.root || (this._scene);
      if(scene) applyMaterialRulesToScene(scene, merged);
    }catch(e){ console.warn('[LociMyu patch] applyMaterialRules failed', e); }
    return r;
  };
})();

// --- HEIC conversion recursion guard ---
(function(){
  const sel = document.getElementById('capImageSelect');
  if(!sel) return;
  let busy = false;
  const orig = sel.onchange;
  sel.onchange = async function(e){
    if(busy){ return (typeof orig==='function') && orig.call(this, e); }
    busy = true;
    try{
      const res = await (typeof orig==='function' ? orig.call(this, e) : undefined);
      busy = false;
      return res;
    }catch(err){
      busy = false;
      throw err;
    }
  };
})();

console.log('[LociMyu] Phase1 patch loaded (v1b)');
