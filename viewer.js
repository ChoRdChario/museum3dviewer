// three.js viewer
import * as THREE from 'https://unpkg.com/three@0.157.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'https://unpkg.com/three@0.157.0/examples/jsm/loaders/GLTFLoader.js';

function hslToColor(h, s, l){
  const c = new THREE.Color();
  c.setHSL(((h%360)+360)%360/360, s, l);
  return c;
}

export class Viewer{
  constructor(host){
    this.host = host;
    this.scene = new THREE.Scene();
    this.bg = new THREE.Color(0x101014);
    this.scene.background = this.bg;
    this.renderer = new THREE.WebGLRenderer({antialias:true, alpha:false});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(host.clientWidth, host.clientHeight);
    host.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(50, host.clientWidth/host.clientHeight, 0.01, 1000);
    this.camera.position.set(1.8, 1.2, 2.2);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.clock = new THREE.Clock();
    this.meshRoot = new THREE.Group();
    this.scene.add(this.meshRoot);

    const light = new THREE.DirectionalLight(0xffffff, 1.2);
    light.position.set(3, 5, 2);
    this.scene.add(light);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.4));

    this.materials = []; // unique material list
    this.matState = new Map(); // material -> saved state

    const onResize = ()=>{
      const w = host.clientWidth, h = host.clientHeight;
      this.camera.aspect = w/h; this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h);
    };
    addEventListener('resize', onResize);

    const animate = ()=>{
      requestAnimationFrame(animate);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    animate();
  }

  clear(){
    while(this.meshRoot.children.length) this.meshRoot.remove(this.meshRoot.children.pop());
    this.materials.length = 0;
    this.matState.clear();
  }

  async loadGLBFromArrayBuffer(ab){
    this.clear();
    const loader = new GLTFLoader();
    const gltf = await new Promise((resolve, reject)=>{
      loader.parse(ab, '', resolve, reject);
    });
    this.meshRoot.add(gltf.scene);
    // unique materials
    const set = new Set();
    gltf.scene.traverse(o=>{
      if (o.isMesh && o.material){
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(m=>set.add(m));
      }
    });
    this.materials = Array.from(set);
    console.log('[viewer] GLB loaded; unique materials:', this.materials.length);
    dispatchEvent(new CustomEvent('lmy:model-loaded'));
  }

  listMaterialLabels(){
    const arr = [['(All)', -1]];
    this.materials.forEach((m,i)=>{
      arr.push([`${i}: ${m.name||'(mat)'}`, i]);
    });
    return arr;
  }

  /** target: -1 for all or index */
  applyToTarget(target, fn){
    if (target === -1){ this.materials.forEach(fn); }
    else if (this.materials[target]) fn(this.materials[target]);
  }

  ensureState(mat){
    if (this.matState.has(mat)) return this.matState.get(mat);
    const s = {
      transparent: mat.transparent,
      side: mat.side,
      color: mat.color?.clone?.() ?? null,
      map: mat.map || null,
      onBeforeCompile: mat.onBeforeCompile || null,
      depthWrite: mat.depthWrite,
      depthTest: mat.depthTest,
      blending: mat.blending,
      opacity: ('opacity' in mat) ? mat.opacity : 1,
      userData: JSON.parse(JSON.stringify(mat.userData||{}))
    };
    this.matState.set(mat, s);
    return s;
  }

  setOpacity(target, v){
    this.applyToTarget(target, (m)=>{
      this.ensureState(m);
      m.transparent = v < 0.999;
      m.opacity = v;
      m.needsUpdate = true;
    });
  }

  setUnlit(target, on){
    this.applyToTarget(target, (m)=>{
      const s = this.ensureState(m);
      if (on){
        m.userData._savedLights = { ...s };
        m.onBeforeCompile = (shader)=>{
          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <lights_fragment_begin>',''
          );
        };
        m.lights = false;
      }else{
        // restore conservative subset
        m.onBeforeCompile = s.onBeforeCompile;
        m.lights = true;
      }
      m.needsUpdate = true;
    });
  }

  setDoubleSide(target, on){
    this.applyToTarget(target, m=>{
      this.ensureState(m);
      m.side = on ? THREE.DoubleSide : THREE.FrontSide;
      m.needsUpdate = true;
    });
  }

  /** White key to alpha (simple brightness key). enable by threshold>0, typical 0.7..1.0 */
  setWhiteKey(target, threshold){
    this.applyToTarget(target, m=>{
      this.ensureState(m);
      if (!threshold || threshold<=0){
        // restore
        m.onBeforeCompile = (this.matState.get(m).onBeforeCompile) || null;
        m.alphaTest = 0;
        m.needsUpdate = true;
        return;
      }
      m.transparent = true;
      m.alphaTest = 0.001;
      m.onBeforeCompile = (shader)=>{
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          '#include <dithering_fragment>\n' +
          '  float lum = dot(gl_FragColor.rgb, vec3(0.299,0.587,0.114));\n' +
          f'  if(lum > {threshold:.3f}) gl_FragColor.a = 0.0;\n'
        );
      };
      m.needsUpdate = true;
    });
  }

  setHueSatLight(target, h, s, l){
    this.applyToTarget(target, m=>{
      this.ensureState(m);
      // cheap multiplicative tweak: tint color when no map, else modulate via color
      if (!m.color) return;
      const base = hslToColor(h, Math.min(s,2), Math.min(l,2));
      m.color.copy(base);
      m.needsUpdate = true;
    });
  }

  setBackground(isDark){
    this.bg.set(isDark?0x101014:0xeeeeee);
    this.scene.background = this.bg;
  }
}
