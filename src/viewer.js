import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class Viewer extends EventTarget{
  constructor(){
    super();
    this._mounted = false;
    this._raf = 0;
    this._idleMs = 15000;
    this._lastActive = performance.now();
    this._scene = new THREE.Scene();
    this._scene.background = new THREE.Color(0x0f1115);
    this._camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    this._camera.position.set(0, 1, 3);
    this._renderer = new THREE.WebGLRenderer({ antialias:true, alpha:false, powerPreference:'high-performance' });
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    this._renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this._controls = null;
    this._root = null;
    this._model = null;
    this._resizeObs = null;
    this._loader = new GLTFLoader();
  }

  mount(root){
    if (this._mounted) return;
    this._mounted = true;
    this._root = root;
    root.appendChild(this._renderer.domElement);
    const light = new THREE.DirectionalLight(0xffffff, 1.1);
    light.position.set(2,3,4);
    this._scene.add(light);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    this._controls = new OrbitControls(this._camera, this._renderer.domElement);
    this._controls.enableDamping = true;
    this._controls.addEventListener('start', ()=>this._poke());
    this._controls.addEventListener('change', ()=>this._poke());

    const ro = this._resizeObs = new ResizeObserver(()=> this._resize());
    ro.observe(this._root);
    this._resize();

    const dom = this._renderer.domElement;
    ['pointerdown','wheel','keydown','touchstart'].forEach(ev=> dom.addEventListener(ev, ()=>this._poke(), {passive:true}));
    this._start();
  }

  async loadFromObjectURL(objectUrl){
    if (this._model){ this._scene.remove(this._model); this._disposeObject(this._model); this._model=null; }
    const gltf = await this._loader.loadAsync(objectUrl);
    this._model = gltf.scene;
    this._scene.add(this._model);
    this.focusOrigin();
    this.dispatchEvent(new CustomEvent('modelLoaded', { detail: { scene: this._model } }));
  }

  focusOrigin(){
    const box = new THREE.Box3().setFromObject(this._model || this._scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size); box.getCenter(center);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const dist = maxDim * 1.6;
    this._controls.target.copy(center);
    this._camera.position.copy(center.clone().add(new THREE.Vector3(dist, dist*0.6, dist)));
    this._camera.near = Math.max(0.01, maxDim/500);
    this._camera.far = Math.max(1000, maxDim*10);
    this._camera.updateProjectionMatrix();
    this._poke();
  }

  _resize(){
    const w = this._root.clientWidth || 640;
    const h = this._root.clientHeight || 480;
    this._camera.aspect = w/h; this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h, false);
    this._poke();
  }

  _poke(){
    this._lastActive = performance.now();
    if (!this._raf) this._start();
  }

  _start(){
    const loop = (t)=>{
      const idle = (t - this._lastActive) > this._idleMs;
      if (idle){ this._raf = 0; return; }
      this._raf = requestAnimationFrame(loop);
      this._controls?.update();
      this._renderer.render(this._scene, this._camera);
    };
    if (!this._raf) this._raf = requestAnimationFrame(loop);
  }

  _disposeObject(obj){
    obj.traverse(o=>{
      if (o.geometry) o.geometry.dispose?.();
      if (o.material){
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        ms.forEach(m=>{
          if (m.map) m.map.dispose?.();
          if (m.dispose) m.dispose();
        });
      }
    });
  }
}
