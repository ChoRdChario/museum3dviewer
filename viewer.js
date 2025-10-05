import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class ViewerApp{
  constructor(stageEl, leaderCanvas){
    this.stageEl = stageEl;
    this.leader = leaderCanvas;
    this.clock = new THREE.Clock();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d0f14');
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000);
    this.camera.position.set(4,3,6);
    this.renderer = new THREE.WebGLRenderer({antialias:true});
    this.renderer.setPixelRatio(devicePixelRatio);
    stageEl.appendChild(this.renderer.domElement);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);

    this.demoCube();

    window.addEventListener('resize', ()=>this.resize());
    this.resize();
    this.ready = this.loop();
  }

  demoCube(){
    const g = new THREE.BoxGeometry(1,1,1);
    const m = new THREE.MeshStandardMaterial({color:0x1e2b47, metalness:0.1, roughness:0.9, transparent:true, opacity:1});
    const mesh = new THREE.Mesh(g,m);
    this.scene.add(mesh);
    this.cube = mesh;

    const dir = new THREE.DirectionalLight(0xffffff, 1.2);
    dir.position.set(2,3,4);
    this.scene.add(dir, new THREE.AmbientLight(0xffffff,0.2));
  }

  resize(){
    const w = this.stageEl.clientWidth;
    const h = this.stageEl.clientHeight;
    this.camera.aspect = w/h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);
    this.leader.width = w; this.leader.height = h;
  }

  async loop(){
    const render = ()=>{
      const t = this.clock.getElapsedTime();
      if(this.cube) { this.cube.rotation.y = t*0.5; }
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(render);
    };
    render();
  }

  setBackground(hex){
    this.scene.background = new THREE.Color(hex);
  }

  async loadGLBFromURL(url){
    const loader = new GLTFLoader();
    return new Promise((res,rej)=>{
      loader.load(url, (gltf)=>{
        if(this.model) this.scene.remove(this.model);
        this.model = gltf.scene;
        this.scene.add(this.model);
        res(gltf);
      }, undefined, rej);
    });
  }
}
