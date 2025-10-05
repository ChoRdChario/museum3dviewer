import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

export class ViewerApp {
  constructor(canvasId='stage'){
    const canvas = document.getElementById(canvasId)
    if (!canvas) throw new Error('canvas not found')
    this.canvas = canvas
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.scene = new THREE.Scene()
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 2000)
    this.camera.position.set(2.4, 1.8, 2.4)
    this.controls = new OrbitControls(this.camera, this.canvas)
    this.controls.enableDamping = true
    this.clock = new THREE.Clock()
    this._raf = 0
    this._animate = this._animate.bind(this)
    this._onResize = this._onResize.bind(this)
    window.addEventListener('resize', this._onResize)
    this._onResize()
    this._start()
    this._addDemoCube()
  }

  _start(){
    cancelAnimationFrame(this._raf)
    this._raf = requestAnimationFrame(this._animate)
  }
  _animate(){
    this.controls.update()
    this.renderer.render(this.scene, this.camera)
    this._raf = requestAnimationFrame(this._animate)
  }
  _onResize(){
    const w = this.canvas.clientWidth || this.canvas.parentElement.clientWidth || 800
    const h = this.canvas.clientHeight || this.canvas.parentElement.clientHeight || 600
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.renderer.setSize(w, h, false)
  }
  _addDemoCube(){
    const g = new THREE.BoxGeometry(1,1,1)
    const m = new THREE.MeshStandardMaterial({ color:0x1d2a44, roughness:0.8, metalness:0.1 })
    const mesh = new THREE.Mesh(g,m)
    this.scene.add(mesh)
    const amb = new THREE.AmbientLight(0xffffff, 0.9); this.scene.add(amb)
    const dir = new THREE.DirectionalLight(0xffffff, 0.8); dir.position.set(5,5,5); this.scene.add(dir)
  }

  // === Material helpers ===
  setOpacity(value=1){
    this.scene.traverse(o=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach(mat=>{ mat.transparent = value < 1; mat.opacity = value; mat.needsUpdate = true })
      }
    })
  }
  setUnlit(on=false){
    this.scene.traverse(o=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach(mat=>{
          mat.lights = !on
          mat.needsUpdate = true
        })
      }
    })
  }
  setDoubleSide(on=false){
    this.scene.traverse(o=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material]
        mats.forEach(mat=>{ mat.side = on ? THREE.DoubleSide : THREE.FrontSide; mat.needsUpdate = true })
      }
    })
  }

  // === GLB ===
  async loadGLBArrayBuffer(buf){
    const loader = new GLTFLoader()
    return await new Promise((resolve, reject)=>{
      loader.parse(buf, '', (gltf)=>{
        const root = gltf.scene || gltf.scenes?.[0]
        if (root){
          // clear previous imported scene nodes (keep lights/cube)
          // remove meshes tagged as imported first
          const prev = this.scene.getObjectByName('__imported_root__')
          if (prev) this.scene.remove(prev)
          root.name='__imported_root__'
          this.scene.add(root)
        }
        resolve(gltf)
      }, (err)=> reject(err))
    })
  }
}
