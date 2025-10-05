import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export class ViewerApp {
  constructor(host){
    this.host = host;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1000);
    this.camera.position.set(2.5,2.2,2.8);
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    this.renderer.setPixelRatio(devicePixelRatio);
    host.appendChild(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.loader = new GLTFLoader();

    // demo cube
    const geo = new THREE.BoxGeometry(1,1,1);
    const mat = new THREE.MeshStandardMaterial({color:0x20304a, roughness:.9, metalness:.0});
    this.demoMesh = new THREE.Mesh(geo,mat);
    this.scene.add(this.demoMesh);
    const amb = new THREE.AmbientLight(0xffffff, .8);
    const dir = new THREE.DirectionalLight(0xffffff,.6);
    dir.position.set(2,3,4);
    this.scene.add(amb,dir);

    window.addEventListener('resize', ()=>this.resize());
    this.resize();
    this.animate();
  }
  resize(){
    const w = this.host.clientWidth || window.innerWidth-320;
    const h = window.innerHeight;
    this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w,h,false);
  }
  setBackground(hex){
    this.renderer.setClearColor(new THREE.Color(hex));
  }
  async loadGLBFromArrayBuffer(ab){
    // remove demo
    if(this.demoMesh){ this.scene.remove(this.demoMesh); this.demoMesh = null; }
    // dispose previous gltf if any
    if(this.gltfRoot){ this.scene.remove(this.gltfRoot); this.gltfRoot.traverse(o=>{ if(o.material?.map) o.material.map.dispose(); if(o.material) o.material.dispose?.(); if(o.geometry) o.geometry.dispose?.(); }); this.gltfRoot = null; }
    return new Promise((resolve,reject)=>{
      this.loader.parse(ab, '', (gltf)=>{
        this.gltfRoot = gltf.scene;
        this.scene.add(this.gltfRoot);
        this.controls.target.set(0,0,0);
        this.camera.position.set(2.5,2.2,2.8);
        resolve();
      }, (err)=>reject(err));
    });
  }
}

