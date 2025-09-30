// Phase 1d: patch Viewer by importing its module directly
import { Viewer } from './viewer.js';
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

// --- 1) Camera preset remap ---
const _setCam = Viewer.prototype.setCameraPreset;
Viewer.prototype.setCameraPreset = function(dir){
  const remap = { front:'right', back:'left', left:'back', right:'front', top:'top', bottom:'bottom' };
  return _setCam.call(this, remap[dir] || dir);
};

// --- 2) Ortho wheel zoom + retarget controls ---
const _toggleOrtho = Viewer.prototype.toggleOrtho;
Viewer.prototype.toggleOrtho = function(on){
  const r = _toggleOrtho.call(this, on);
  const cam = this.activeCamera;
  if(this.controls){
    this.controls.object = cam;
    this.controls.enableZoom = true;
    this.controls.zoomToCursor = true;
    this.controls.update();
  }
  if(cam && cam.isOrthographicCamera){
    if(!cam.zoom || cam.zoom < 0.1) cam.zoom = 1.0;
    cam.updateProjectionMatrix();
  }
  return r;
};

// --- 3) White/Black key via shader inject; opacity model tidy ---
function applyColorKeyToMaterial(mat, cfg){
  const hasMap = !!mat.map;
  const wantKey = (cfg.whiteKey || cfg.blackKey) && hasMap;
  mat.alphaTest = 0.0;
  mat.transparent = (cfg.opacity < 1.0) || wantKey;
  mat.opacity = cfg.opacity;
  mat.depthWrite = !mat.transparent;
  if(!mat.userData) mat.userData = {};

  if(!wantKey){
    if(mat.userData.__lmy_restore){ mat.onBeforeCompile = mat.userData.__lmy_restore; }
    mat.needsUpdate = true; return;
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
  if(!mat.userData.__lmy_restore){ mat.userData.__lmy_restore = mat.onBeforeCompile; }
  mat.onBeforeCompile = function(shader){
    if(typeof mat.userData.__lmy_restore === 'function'){ try{ mat.userData.__lmy_restore(shader); }catch(e){} }
    inject(shader);
  };
  mat.needsUpdate = true;
}

const _applyMat = Viewer.prototype.applyMaterialConfig;
Viewer.prototype.applyMaterialConfig = function(){
  const cfg = this.currentMaterialCfg || { opacity:1, doubleSided:false, unlit:false };
  this.meshRoot.traverse(obj=>{
    if(!obj.isMesh) return;
    let mat = obj.material;
    if(cfg.unlit && !(mat instanceof THREE.MeshBasicMaterial)){
      const next = new THREE.MeshBasicMaterial({
        map: mat.map||null,
        color: mat.color?.getHex()||0xffffff,
        transparent: true,
        opacity: cfg.opacity
      });
      next.side = cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      obj.material = next;
      applyColorKeyToMaterial(next, cfg);
    }else{
      mat.side = cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      applyColorKeyToMaterial(mat, cfg);
    }
  });
  // no call to original; we are replacing behavior
};

console.log('[LociMyu] Phase1d patch loaded');