// viewer.js  (ESM, CDN imports)
import * as THREE from 'https://unpkg.com/three@0.160.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.1/examples/jsm/loaders/GLTFLoader.js';

function ensureArray(x){return Array.isArray(x)?x:[x];}
function forEachMaterial(root,fn){
  root.traverse((o)=>{ if(o.isMesh&&o.material){ ensureArray(o.material).forEach(m=>m&&fn(m,o)); } });
}
function uniqueMaterials(root){
  const set=new Set(), list=[];
  forEachMaterial(root,(m)=>{ if(!set.has(m)){ set.add(m); list.push(m);} });
  return list;
}
function patchWhiteKey(material){
  if(material.userData.__whiteKeyPatched) return;
  material.onBeforeCompile=(shader)=>{
    shader.uniforms.uWhiteKeyEnabled={ value: material.userData.__whiteKeyEnabled||false };
    shader.uniforms.uWhiteKeyThreshold={ value: material.userData.__whiteKeyThreshold ?? 0.95 };
    shader.fragmentShader = shader.fragmentShader.replace(
      /void\s+main\(\)\s*\{/,
      (m)=>`${m}
        #ifdef USE_MAP
          vec4 __tex = texture2D( map, vUv );
        #else
          vec4 __tex = vec4(1.0);
        #endif
      `
    );
    shader.fragmentShader = shader.fragmentShader.replace(/\}\s*$/,
      `
        if (uWhiteKeyEnabled){
          vec3 rgb = gl_FragColor.rgb;
          float m = max(rgb.r, max(rgb.g, rgb.b)); // white-ish key
          if (m >= uWhiteKeyThreshold){ gl_FragColor.a = 0.0; }
        }
      }
      `
    );
    material.userData.__whiteKeyUniforms = shader.uniforms;
  };
  material.userData.__whiteKeyPatched=true;
  material.needsUpdate=true;
}
function applyTransparencyFlags(material){
  if(material.transparent){ material.depthWrite=false; material.side = material.side ?? THREE.FrontSide; }
  else { material.depthWrite=true; }
  material.needsUpdate=true;
}
function setMaterialUnlit(material,on){
  const ud=material.userData;
  if(on){
    if(ud.__litBackup) return;
    const basic=new THREE.MeshBasicMaterial({
      color: material.color?.clone?.() ?? new THREE.Color(0xffffff),
      map: material.map || null,
      transparent: material.transparent || (material.opacity<1.0),
      opacity: material.opacity ?? 1.0,
      side: material.side ?? THREE.FrontSide
    });
    basic.name = `${material.name||'mat'}(Unlit)`;
    basic.userData.__whiteKeyEnabled = ud.__whiteKeyEnabled || false;
    basic.userData.__whiteKeyThreshold = ud.__whiteKeyThreshold ?? 0.95;
    patchWhiteKey(basic);
    ud.__litBackup = material;
    return basic;
  }else{
    if(!ud.__litBackup) return;
    const original = ud.__litBackup;
    ud.__litBackup = null;
    return original;
  }
}

export class Viewer{
  constructor(canvas){
    this.canvas=canvas;
    this.renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene=new THREE.Scene();
    this.scene.background=new THREE.Color(0x111216);
    this.camera=new THREE.PerspectiveCamera(50,1,0.01,2000);
    this.camera.position.set(0.6,0.6,1.2);
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;
    const amb=new THREE.AmbientLight(0xffffff,0.6);
    const dir=new THREE.DirectionalLight(0xffffff,0.8); dir.position.set(1,1.5,1.2);
    this.scene.add(amb,dir);
    this.loader=new GLTFLoader();
    this.model=null;
    this.materials=[];
    this.targetIndex=-1;
    this.hsl={h:0,s:0,l:0};
    window.addEventListener('resize',()=>this._resize());
    this._resize();
    const tick=()=>{ requestAnimationFrame(tick); this.controls.update(); this.renderer.render(this.scene,this.camera); };
    tick();
  }
  async loadGLBFromArrayBuffer(arrayBuffer){
    const glb=await this.loader.parseAsync(arrayBuffer,'');
    this._setModel(gltfScene(glb));
  }
  async loadGLBFromDrive(fileId){
    if(!window.fetchDriveFileAsArrayBuffer) throw new Error('fetchDriveFileAsArrayBuffer(fileId) が見つかりません');
    const ab=await window.fetchDriveFileAsArrayBuffer(fileId);
    await this.loadGLBFromArrayBuffer(ab);
  }
  listMaterialLabels(){ return ['(All)', ...this.materials.map((m,i)=>`${i}: ${m.name||'material'}`)]; }
  setTargetMaterialIndex(i){ this.targetIndex=(typeof i==='number')?i:-1; }
  setHSL({h,s,l}){
    if(typeof h==='number') this.hsl.h=h;
    if(typeof s==='number') this.hsl.s=s;
    if(typeof l==='number') this.hsl.l=l;
    const apply=(m)=>{ const c=m.color??(m.color=new THREE.Color(0xffffff)); c.setHSL(this.hsl.h,this.hsl.s,this.hsl.l); m.needsUpdate=true; };
    this._forTargets(apply);
  }
  setOpacity(alpha){
    const a=Math.max(0,Math.min(1,alpha));
    const apply=(m)=>{ m.opacity=a; m.transparent=(a<1.0)||(m.userData?.__whiteKeyEnabled??false); applyTransparencyFlags(m); };
    this._forTargets(apply);
  }
  setDoubleSide(on){ const side=on?THREE.DoubleSide:THREE.FrontSide; this._forTargets((m)=>{ m.side=side; m.needsUpdate=true; }); }
  setUnlit(on){
    if(!this.model) return;
    const replace=(mesh)=>{
      const mats=ensureArray(mesh.material);
      const newMats=mats.map((m)=>{ if(!this._isTarget(m)) return m; const r=setMaterialUnlit(m,on); return r?r:m; });
      if(newMats.some((m,i)=>m!==mats[i])) mesh.material=(newMats.length===1?newMats[0]:newMats);
    };
    this.model.traverse((o)=>{ if(o.isMesh&&o.material) replace(o); });
  }
  setWhiteKey(enabled,threshold){
    const t=(typeof threshold==='number')?threshold:undefined;
    this._forTargets((m)=>{
      patchWhiteKey(m);
      m.userData.__whiteKeyEnabled=!!enabled;
      if(typeof t==='number') m.userData.__whiteKeyThreshold=t;
      const u=m.userData.__whiteKeyUniforms;
      if(u){ u.uWhiteKeyEnabled.value=!!enabled; if(typeof t==='number') u.uWhiteKeyThreshold.value=t; }
      m.transparent=(m.opacity<1.0)||!!enabled; applyTransparencyFlags(m); m.needsUpdate=true;
    });
  }
  setBackground(hex){ this.scene.background=new THREE.Color(hex); }
  _forTargets(fn){
    if(!this.model) return;
    const mats=(this.targetIndex<=0)?this.materials:[this.materials[this.targetIndex-1]].filter(Boolean);
    mats.forEach((m)=>m&&fn(m));
  }
  _setModel(scene){
    if(this.model){
      this.scene.remove(this.model);
      this.model.traverse((o)=>{
        if(o.geometry) o.geometry.dispose?.();
        if(o.material){ ensureArray(o.material).forEach((m)=>{ m.map?.dispose?.(); m.dispose?.(); }); }
      });
    }
    this.model=scene; this.scene.add(scene);
    this.materials=uniqueMaterials(scene);
    this.materials.forEach((m)=>{ m.transparent=m.opacity<1.0; applyTransparencyFlags(m); patchWhiteKey(m); });
    const box=new THREE.Box3().setFromObject(scene);
    const size=new THREE.Vector3(); const center=new THREE.Vector3(); box.getSize(size); box.getCenter(center);
    const radius=size.length()*0.5; const dist=radius/Math.sin((this.camera.fov*Math.PI/180)/2);
    this.controls.target.copy(center);
    this.camera.position.copy(center).add(new THREE.Vector3(dist*0.4,dist*0.3,dist*0.6));
    this.camera.near=Math.max(0.01,dist*0.001); this.camera.far=dist*10.0; this.camera.updateProjectionMatrix();
  }
  _isTarget(m){ if(this.targetIndex<=0) return true; const target=this.materials[this.targetIndex-1]; return m===target; }
  _resize(){
    const w=this.canvas.clientWidth, h=this.canvas.clientHeight; if(w===0||h===0) return;
    this.renderer.setSize(w,h,false); this.camera.aspect=w/h; this.camera.updateProjectionMatrix();
  }
}
function gltfScene(g){ const s=g.scene||g.scenes?.[0]; if(!s) throw new Error('GLB から scene を取得できません'); return s; }
export function createViewer(canvas){ return new Viewer(canvas); }
