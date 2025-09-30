import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'https://unpkg.com/three@0.160.0/examples/jsm/renderers/CSS2DRenderer.js';

export class Viewer {
  constructor(container){
    this.container = container;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.01, 1000);
    this.camera.position.set(2,1.5,2.5);
    this.renderer = new THREE.WebGLRenderer({ antialias:true, alpha:true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.setClearColor(0x202225, 1);
    container.appendChild(this.renderer.domElement);

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    container.appendChild(this.labelRenderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    const light1 = new THREE.DirectionalLight(0xffffff, 1.0);
    light1.position.set(3,5,2);
    this.scene.add(light1);
    const amb = new THREE.AmbientLight(0xffffff, .5);
    this.scene.add(amb);

    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.meshRoot = new THREE.Group();
    this.scene.add(this.meshRoot);

    this.pinGroup = new THREE.Group();
    this.scene.add(this.pinGroup);

    this.pins = new Map(); // id => { xyz, color, title, body, imageId, imageName, dotMesh, line, label }
    this.currentMaterialCfg = { opacity: 1, doubleSided: false, unlit: false, whiteKey: false, whiteThr: .95, blackKey: false, blackThr: .05 };

    this.ortho = null; // Ortho camera
    this.useOrtho = false;

    this.resize();
    window.addEventListener('resize', ()=>this.resize());
    this.renderer.domElement.addEventListener('pointermove', e=>this.onPointerMove(e));
  }

  setBgColor(hex){
    this.renderer.setClearColor(new THREE.Color(hex), 1);
  }

  resize(){
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);
    this.labelRenderer.setSize(w,h);
    if(this.ortho){
      this.ortho.left = -h/200; this.ortho.right = h/200;
      this.ortho.top = h/200; this.ortho.bottom = -h/200;
      this.ortho.updateProjectionMatrix();
    }
  }

  toggleOrtho(on){
    this.useOrtho = on;
    if(on && !this.ortho){
      const s=2;
      this.ortho = new THREE.OrthographicCamera(-s,s,s,-s,0.01,1000);
      this.ortho.position.copy(this.camera.position);
      this.ortho.lookAt(0,0,0);
    }
  }
  get activeCamera(){ return this.useOrtho ? this.ortho : this.camera; }

  async loadGLB(arrayBuffer){
    // Dispose previous
    this.meshRoot.clear();
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(arrayBuffer, '');
    this.meshRoot.add(gltf.scene);
    this.fitCameraToObject(gltf.scene);
    this.applyMaterialConfig();
    return gltf.scene;
  }

  fitCameraToObject(obj){
    const box = new THREE.Box3().setFromObject(obj);
    const size = new THREE.Vector3(); box.getSize(size);
    const center = new THREE.Vector3(); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z);
    const dist = maxDim*1.8;
    this.camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.6, dist)));
    this.controls.target.copy(center);
    this.controls.update();
    if(this.ortho){
      this.ortho.position.copy(this.camera.position);
      this.ortho.lookAt(center);
    }
  }

  setCameraPreset(preset){
    const t = this.controls.target.clone();
    const d = 2.0;
    const map = {
      front: new THREE.Vector3(0,0,d),
      back:  new THREE.Vector3(0,0,-d),
      left:  new THREE.Vector3(-d,0,0),
      right: new THREE.Vector3(d,0,0),
      top:   new THREE.Vector3(0,d,0),
      bottom:new THREE.Vector3(0,-d,0),
    };
    const off = map[preset] || new THREE.Vector3(0,0,d);
    const pos = t.clone().add(off.multiplyScalar(2.5));
    this.camera.position.copy(pos);
    this.camera.up.set(0,1,0);
    this.camera.lookAt(t);
    if(this.ortho){
      this.ortho.position.copy(pos);
      this.ortho.lookAt(t);
    }
  }

  onPointerMove(e){
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
  }

  pick(intersectMeshesOnly=true){
    const cam = this.activeCamera;
    this.raycaster.setFromCamera(this.pointer, cam);
    const objs = [];
    this.meshRoot.traverse(o=>{ if(o.isMesh) objs.push(o); });
    const hits = this.raycaster.intersectObjects(objs, true);
    return hits[0] || null;
  }

  addPinAt(xyz, color='red', id){
    const pid = id || `p_${(Math.random()*1e9|0).toString(36)}`;
    const geom = new THREE.SphereGeometry(0.006, 16, 16);
    const mat = new THREE.MeshBasicMaterial({ color: this.colorToHex(color) });
    const dot = new THREE.Mesh(geom, mat);
    dot.position.copy(xyz);
    this.pinGroup.add(dot);

    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff });
    const lineGeom = new THREE.BufferGeometry().setFromPoints([xyz, xyz.clone().add(new THREE.Vector3(0.12,0.12,0))]);
    const line = new THREE.Line(lineGeom, lineMat);

    const labelEl = document.createElement('div');
    labelEl.className = 'pin-label';
    labelEl.textContent = '...';
    const label = new CSS2DObject(labelEl);
    label.position.copy(xyz.clone().add(new THREE.Vector3(0.12,0.12,0)));
    this.pinGroup.add(line);
    this.pinGroup.add(label);

    this.pins.set(pid, { id:pid, xyz: xyz.clone(), color, title:'', body:'', imageId:'', imageName:'', dotMesh:dot, line, label });
    return pid;
  }

  updatePinVisual(pid, data){
    const rec = this.pins.get(pid); if(!rec) return;
    if(data.title!==undefined) rec.title = data.title;
    if(data.body!==undefined) rec.body = data.body;
    if(data.color!==undefined){
      rec.color = data.color;
      rec.dotMesh.material.color.set(this.colorToHex(rec.color));
    }
    if(data.imageId!==undefined) rec.imageId = data.imageId;
    if(data.imageName!==undefined) rec.imageName = data.imageName;
    rec.label.element.textContent = rec.title || '(無題)';
  }

  removePin(pid){
    const rec = this.pins.get(pid); if(!rec) return;
    if(rec.dotMesh) this.pinGroup.remove(rec.dotMesh);
    if(rec.line) this.pinGroup.remove(rec.line);
    if(rec.label) this.pinGroup.remove(rec.label);
    this.pins.delete(pid);
  }

  colorToHex(name){
    const map = { red:'#ff5964', orange:'#ff9f1c', yellow:'#ffe066', green:'#2ec4b6', cyan:'#5bc0eb', blue:'#4dabf7', magenta:'#c77dff', white:'#fafafa' };
    return map[name] || '#ff5964';
  }

  applyMaterialConfig(){
    const cfg = this.currentMaterialCfg;
    const makeUnlit = cfg.unlit;
    this.meshRoot.traverse(obj=>{
      if(!obj.isMesh) return;
      let mat = obj.material;
      if(makeUnlit){
        // Convert to MeshBasicMaterial preserving map/color/opacity
        const next = new THREE.MeshBasicMaterial({ map: mat.map||null, color: mat.color?.getHex()||0xffffff, transparent:true, opacity: cfg.opacity });
        next.side = cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        obj.material = next;
      }else{
        mat.transparent = true;
        mat.opacity = cfg.opacity;
        mat.side = cfg.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
        // Simple color key via alphaTest (approx): requires texture present.
        if(cfg.whiteKey && mat.map){ mat.alphaTest = cfg.whiteThr; }
        else if(cfg.blackKey && mat.map){ mat.alphaTest = cfg.blackThr; }
        else { mat.alphaTest = 0.0; }
      }
    });
  }

  setMaterialConfig(partial){
    Object.assign(this.currentMaterialCfg, partial);
    this.applyMaterialConfig();
  }

  animate(){
    requestAnimationFrame(()=>this.animate());
    this.controls.update();
    this.renderer.render(this.scene, this.activeCamera);
    this.labelRenderer.render(this.scene, this.activeCamera);
  }
}
