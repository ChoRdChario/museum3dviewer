// viewer.js
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class M3DViewer {
  constructor(hostEl){
    this.host = hostEl;
    this.scene = null; this.camera = null; this.renderer = null;
    this.controls = null; this.loader = null; this.root = null;
    this._animId = 0; this._active = TrueBool(); this._lastInteraction = Date.now();
    this._idleMs = 12000;
    this._onResize = this._resize.bind(this);
    this._init();
  }
  _init(){
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0d10);
    this.camera = new THREE.PerspectiveCamera(60, w/h, 0.01, 1000);
    this.camera.position.set(0.8, 0.6, 1.2);
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio||1, 2));
    this.renderer.setSize(w, h);
    this.host.appendChild(this.renderer.domElement);

    const light = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
    this.scene.add(light);
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(1,1,1);
    this.scene.add(dir);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    ['start','end','change'].forEach(ev=>{
      this.controls.addEventListener(ev, ()=>this._touch());
    });

    this.loader = new GLTFLoader();
    window.addEventListener('resize', this._onResize);
    this.renderer.domElement.addEventListener('pointerdown', ()=>this._touch());
    this.renderer.domElement.addEventListener('wheel', ()=>this._touch(), {passive:true});
    this._loop();
  }
  dispose(){
    cancelAnimationFrame(this._animId);
    window.removeEventListener('resize', this._onResize);
    if (this.root){ this._disposeObject(this.root); this.root = null; }
    if (this.renderer){ this.renderer.dispose(); }
    if (this.host && this.renderer && this.renderer.domElement){
      try { this.host.removeChild(this.renderer.domElement); } catch(_){}
    }
  }
  _disposeObject(obj){
    obj.traverse((o)=>{
      if (o.isMesh){
        if (o.geometry) o.geometry.dispose();
        if (o.material){
          if (Array.isArray(o.material)){ o.material.forEach(m=>m.dispose && m.dispose()); }
          else { o.material.dispose && o.material.dispose(); }
        }
      }
    });
  }
  _resize(){
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    if (!this.camera || !this.renderer) return;
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);
    this._touch();
  }
  _touch(){ this._lastInteraction = Date.now(); if (!this._active){ this._active=true; this._loop(); } }
  _loop(){
    const now = Date.now();
    if (this._active && now - this._lastInteraction > this._idleMs){
      this._active = false; return;
    }
    this._animId = requestAnimationFrame(()=>this._loop());
    if (this.controls) this.controls.update();
    if (this.renderer && this.scene && this.camera) this.renderer.render(this.scene, this.camera);
  }
  focusTo(obj){
    try{
      const box = new THREE.Box3().setFromObject(obj);
      const size = new THREE.Vector3(); box.getSize(size);
      const center = new THREE.Vector3(); box.getCenter(center);
      const maxDim = Math.max(size.x,size.y,size.z) || 1;
      const dist = maxDim * 1.8;
      this.camera.position.copy(center).add(new THREE.Vector3(dist, dist*0.8, dist));
      this.controls.target.copy(center);
      this.controls.update();
    }catch(_){}
  }
  async loadObjectURL(url){
    if (this.root){ this._disposeObject(this.root); this.scene.remove(this.root); this.root=null; }
    return new Promise((resolve,reject)=>{
      this.loader.load(url, (gltf)=>{
        this.root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
        if (this.root){ this.scene.add(this.root); this.focusTo(this.root); }
        resolve(this.root);
      }, undefined, (err)=>reject(err));
    });
  }
}

// Small helper to avoid minifier issues with booleans
function TrueBool(){ return true; }
