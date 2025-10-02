// features/materialUI.js
import * as THREE from 'three';
import { store } from '../core/store.js';

export function mountMaterialUI({ bus, viewer }) {
  const side = document.getElementById('side');
  if (!side) return;

  const wrap = document.createElement('div');
  wrap.id = 'material-ui';
  wrap.style.marginTop = '12px';
  wrap.innerHTML = `
    <h3 style="margin:0 0 8px;">Material Settings</h3>
    <div style="display:grid; gap:8px;">
      <label style="display:grid; gap:4px;">
        <span style="font-size:12px;color:#aaa;">Target Material</span>
        <select id="mat-target" style="padding:6px;border:1px solid #333;border-radius:8px;background:#111;color:#fff;"></select>
      </label>
      <div style="display:grid;gap:6px;">
        <label>Hue <input id="mat-h" type="range" min="0" max="360" value="0"></label>
        <label>Saturation <input id="mat-s" type="range" min="0" max="100" value="100"></label>
        <label>Lightness <input id="mat-l" type="range" min="0" max="100" value="50"></label>
      </div>
      <label>Opacity <input id="mat-o" type="range" min="0" max="1" step="0.01" value="1"></label>
      <label><input id="mat-unlit" type="checkbox"> Unlit (ignore lights)</label>
      <div>
        <label><input id="mat-w2a" type="checkbox"> White → Transparent</label>
        <input id="mat-th" type="range" min="0.85" max="1" step="0.01" value="0.95">
      </div>
    </div>
  `;
  side.appendChild(wrap);

  const sel = wrap.querySelector('#mat-target');
  const h = wrap.querySelector('#mat-h');
  const s = wrap.querySelector('#mat-s');
  const l = wrap.querySelector('#mat-l');
  const o = wrap.querySelector('#mat-o');
  const unlit = wrap.querySelector('#mat-unlit');
  const w2a = wrap.querySelector('#mat-w2a');
  const th = wrap.querySelector('#mat-th');

  const matMap = new Map();

  function collectMaterials() {
    matMap.clear(); sel.innerHTML = '';
    const seen = new Set();
    viewer.scene.traverse(obj => {
      if (obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => {
          if (!m || !m.uuid || seen.has(m.uuid)) return;
          seen.add(m.uuid);
          const opt = document.createElement('option');
          opt.value = m.uuid;
          opt.textContent = `${m.name || 'Material'} • ${m.type}`;
          sel.appendChild(opt);
          matMap.set(m.uuid, m);
        });
      }
    });
  }

  const toUnlit = (mat) => {
    if (mat instanceof THREE.MeshBasicMaterial) return mat;
    const b = new THREE.MeshBasicMaterial({
      color: mat.color?.clone?.() || new THREE.Color(1,1,1),
      transparent: true, opacity: ('opacity' in mat ? mat.opacity : 1)
    });
    b.__origMat = mat; b.userData.__origMat = mat; return b;
  };
  const fromUnlit = (mat) => mat?.__origMat || mat?.userData?.__origMat || mat;

  function applyWhiteToAlpha(mat, enabled, threshold) {
    if (enabled) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
            if (all(greaterThanEqual(diffuseColor.rgb, vec3(${threshold.toFixed(2)})))) discard;
            #include <dithering_fragment>
          `
        );
      };
    } else {
      mat.onBeforeCompile = null;
    }
    mat.needsUpdate = true;
  }

  function applyAll() {
    const id = sel.value;
    if (!id) return;
    viewer.scene.traverse(obj => {
      if (!(obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let changed = false;
      const nh = parseFloat(h.value)/360, ns = parseFloat(s.value)/100, nl = parseFloat(l.value)/100;
      const no = parseFloat(o.value), w = w2a.checked, t = parseFloat(th.value), u = unlit.checked;
      const newMats = mats.map(m => {
        if (!m || m.uuid !== id) return m;
        let target = m;
        if (u) target = toUnlit(m);
        else if (m instanceof THREE.MeshBasicMaterial) target = fromUnlit(m);
        if (target.color?.setHSL) target.color.setHSL(nh, ns, nl);
        target.transparent = true; target.opacity = no;
        applyWhiteToAlpha(target, w, t);
        changed = changed || (target !== m);
        return target;
      });
      if (changed) obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
    });
  }

  [sel,h,s,l,o,unlit,w2a,th].forEach(el => el.addEventListener('input', applyAll));
  bus.on('model:loaded', () => collectMaterials());
  wrap.style.display = 'block';
  collectMaterials();
}
