import * as THREE from 'three';
import { store } from '../core/store.js';

export function mountMaterialUI({ bus }) {
  const side = document.getElementById('side');
  const wrap = document.createElement('div');
  wrap.id = 'material-ui';
  wrap.style.marginTop = '12px';
  wrap.innerHTML = `
    <h3>Material Settings</h3>
    <div>
      <label>Hue<input id="mat-h" type="range" min="0" max="360" value="0"></label>
      <label>Saturation<input id="mat-s" type="range" min="0" max="100" value="100"></label>
      <label>Lightness<input id="mat-l" type="range" min="0" max="100" value="50"></label>
    </div>
    <div>
      <label>Opacity<input id="mat-o" type="range" min="0" max="1" step="0.01" value="1"></label>
    </div>
    <div>
      <label><input id="mat-unlit" type="checkbox"> Unlit</label>
    </div>
    <div>
      <label><input id="mat-w2a" type="checkbox"> White → Transparent</label>
      <input id="mat-th" type="range" min="0.8" max="1" step="0.01" value="0.95">
    </div>
  `;
  side.appendChild(wrap);
  wrap.style.display = 'none';

  const h = wrap.querySelector('#mat-h');
  const s = wrap.querySelector('#mat-s');
  const l = wrap.querySelector('#mat-l');
  const o = wrap.querySelector('#mat-o');
  const unlit = wrap.querySelector('#mat-unlit');
  const w2a = wrap.querySelector('#mat-w2a');
  const th = wrap.querySelector('#mat-th');

  function apply() {
    const mesh = store.state.selectedMesh;
    if (!mesh) return;
    let mat = mesh.material;
    if (!(mat instanceof THREE.Material)) return;

    // 色
    const hh = parseFloat(h.value) / 360;
    const ss = parseFloat(s.value) / 100;
    const ll = parseFloat(l.value) / 100;
    mat.color.setHSL(hh, ss, ll);

    // 透明度
    mat.transparent = true;
    mat.opacity = parseFloat(o.value);

    // Unlit
    if (unlit.checked && !(mat instanceof THREE.MeshBasicMaterial)) {
      mesh.material = new THREE.MeshBasicMaterial({ color: mat.color, transparent: mat.transparent, opacity: mat.opacity });
      mat = mesh.material;
    } else if (!unlit.checked && (mat instanceof THREE.MeshBasicMaterial)) {
      mesh.material = new THREE.MeshStandardMaterial({ color: mat.color, transparent: mat.transparent, opacity: mat.opacity });
      mat = mesh.material;
    }

    // 白→透明化
    if (w2a.checked) {
      const threshold = parseFloat(th.value);
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
            if (all(greaterThanEqual(diffuseColor.rgb, vec3(${threshold.toFixed(2)})))) discard;
            #include <dithering_fragment>
          `
        );
      };
      mat.needsUpdate = true;
    } else {
      mat.onBeforeCompile = null;
      mat.needsUpdate = true;
    }
  }

  [h, s, l, o, unlit, w2a, th].forEach(el => el.addEventListener('input', apply));

  // 選択メッシュが変わったらUI表示切替
  bus.on('mesh:selected', (mesh) => {
    store.set({ selectedMesh: mesh });
    wrap.style.display = mesh ? 'block' : 'none';
    if (mesh) apply();
  });
}
