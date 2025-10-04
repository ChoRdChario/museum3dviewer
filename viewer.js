// viewer.js — clean minimal viewer with material controls
// ES module
import * as THREE from 'https://unpkg.com/three@0.160.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.160.1/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.1/examples/jsm/loaders/GLTFLoader.js';

export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, canvas.clientWidth / canvas.clientHeight, 0.01, 1000);
    this.camera.position.set(1.5, 1.0, 2.0);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.clock = new THREE.Clock();
    this.model = null;
    this.materials = [];         // unique materials (THREE.Material)
    this.targetIndex = -1;       // -1 => (All)
    this.whiteKey = { enabled: false, threshold: 1.0 };
    this._boundResize = () => this._onResize();
    window.addEventListener('resize', this._boundResize);
    this._start();
  }

  dispose() {
    window.removeEventListener('resize', this._boundResize);
  }

  _onResize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  _start() {
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  async loadDemo() {
    // simple cube
    if (this.model) this._clearModel();
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x345a89, metalness: 0.0, roughness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 2, 2);
    this.scene.add(dir);
    this.scene.add(mesh);
    this.model = mesh;
    this.materials = [mat];
    this.targetIndex = -1;
  }

  async loadGLBFromDrive(fileId) {
    if (!fileId) throw new Error('empty fileId');
    const arrayBuffer = await (window.fetchDriveFileAsArrayBuffer
      ? window.fetchDriveFileAsArrayBuffer(fileId)
      : Promise.reject(new Error('utils_drive_api.fetchDriveFileAsArrayBuffer missing')));
    return this.loadGLBFromArrayBuffer(arrayBuffer);
  }

  async loadGLBFromArrayBuffer(arrayBuffer) {
    if (this.model) this._clearModel();
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject) => {
      loader.parse(arrayBuffer, '', resolve, reject);
    });
    const root = gltf.scene || gltf.scenes[0];
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.8));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(2, 2, 2);
    this.scene.add(dir);
    this.scene.add(root);
    this.model = root;
    this.materials = this._collectUniqueMaterials(root);
    this.targetIndex = -1;
    console.log('[viewer] GLB loaded; unique materials:', this.materials.length);
  }

  _clearModel() {
    // dispose old lights + meshes
    const toRemove = [];
    this.scene.traverse((obj) => {
      if (obj.isLight || obj === this.model) toRemove.push(obj);
    });
    toRemove.forEach(o => this.scene.remove(o));
  }

  _collectUniqueMaterials(root) {
    const set = new Set();
    root.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach(m => set.add(m));
        else set.add(obj.material);
      }
    });
    return Array.from(set);
  }

  listMaterialLabels() {
    const labels = this.materials.map((m, i) => `${i}: ${m.name || 'mat'}`);
    return ['(All)', ...labels];
  }

  setTargetMaterialIndex(i) {
    this.targetIndex = (i === undefined || i === null || i < 0) ? -1 : (i | 0);
  }

  _forEachTargetMaterial(fn) {
    if (this.targetIndex < 0) {
      this.materials.forEach(fn);
    } else {
      const m = this.materials[this.targetIndex];
      if (m) fn(m);
    }
  }

  setHSL({ h = 0.0, s = 0.0, l = 0.0 } = {}) {
    this._forEachTargetMaterial((m) => {
      if (!m.userData.__baseColor) m.userData.__baseColor = (m.color ? m.color.clone() : new THREE.Color(1,1,1));
      const c = m.userData.__baseColor.clone();
      c.offsetHSL(h, s, l);
      if (!m.color) m.color = new THREE.Color();
      m.color.copy(c);
      m.needsUpdate = true;
    });
  }

  setOpacity(alpha) {
    this._forEachTargetMaterial((m) => {
      m.transparent = alpha < 0.999;
      m.opacity = alpha;
      m.depthWrite = !m.transparent;
      m.needsUpdate = true;
    });
  }

  setDoubleSide(on) {
    this._forEachTargetMaterial((m) => {
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    });
  }

  setUnlit(on) {
    this._forEachTargetMaterial((m) => {
      // idempotent unlit toggle using MeshBasicMaterial
      if (on && !(m instanceof THREE.MeshBasicMaterial)) {
        const basic = new THREE.MeshBasicMaterial({});
        basic.copy(m);
        basic.map = m.map || null;
        basic.color = (m.color ? m.color.clone() : new THREE.Color(1,1,1));
        basic.transparent = m.transparent;
        basic.opacity = m.opacity;
        basic.side = m.side;
        m.userData.__litBackup = m; // keep reference
        this._swapMaterial(m, basic);
      } else if (!on && m instanceof THREE.MeshBasicMaterial && m.userData.__litBackup) {
        const original = m.userData.__litBackup;
        this._swapMaterial(m, original);
      }
    });
  }

  _swapMaterial(oldMat, newMat) {
    // replace across meshes that reference oldMat
    this.scene.traverse((obj) => {
      if (obj.isMesh) {
        if (Array.isArray(obj.material)) {
          obj.material = obj.material.map(mm => (mm === oldMat ? newMat : mm));
        } else if (obj.material === oldMat) {
          obj.material = newMat;
        }
      }
    });
    // update materials cache
    const idx = this.materials.indexOf(oldMat);
    if (idx >= 0) this.materials[idx] = newMat;
  }

  setWhiteKey(enabled, threshold = 0.98) {
    this.whiteKey.enabled = !!enabled;
    this.whiteKey.threshold = threshold;
    this._forEachTargetMaterial((m) => {
      if (!m.userData.__whiteKeyPatched) {
        m.onBeforeCompile = (shader) => {
          shader.uniforms.uWhiteKeyEnabled = { value: this.whiteKey.enabled ? 1 : 0 };
          shader.uniforms.uWhiteKey = { value: this.whiteKey.threshold };
          shader.fragmentShader = `
            uniform int uWhiteKeyEnabled;
            uniform float uWhiteKey;
          ` + shader.fragmentShader.replace(
            'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
            `
            #ifdef OPAQUE
              gl_FragColor = vec4( outgoingLight, diffuseColor.a );
            #else
              vec4 col = vec4( outgoingLight, diffuseColor.a );
              if (uWhiteKeyEnabled == 1) {
                float lum = dot(col.rgb, vec3(0.299, 0.587, 0.114));
                float aCut = step(uWhiteKey, lum);
                col.a *= (1.0 - aCut);
              }
              gl_FragColor = col;
            #endif
            `
          );
        };
        m.userData.__whiteKeyPatched = true;
        m.needsUpdate = true;
      } else {
        m.needsUpdate = true;
      }
    });
  }
}

export function createViewer(canvas) {
  return new Viewer(canvas);
}
