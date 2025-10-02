// features/materialUI.js (v6.5.4-1)
import * as THREE from 'three';

let MAT_KEY_SEQ = 1;

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
        <input id="mat-th" type="range" min="0.85" max="1" step="0.01" value="0.98">
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

  const bucket = new Map();

  function ensureMatKey(m) {
    if (!m.userData) m.userData = {};
    if (!m.userData.__matKey) m.userData.__matKey = `mk_${MAT_KEY_SEQ++}`;
    return m.userData.__matKey;
  }

  function copyCommonProps(from, to) {
    const props = [
      'map','alphaMap','aoMap','metalnessMap','roughnessMap','normalMap','emissiveMap',
      'envMap','side','transparent','opacity','alphaTest','depthWrite','depthTest','blending','colorWrite'
    ];
    props.forEach(k => { if (k in from) try { to[k] = from[k]; } catch {} });
    if (from.color && to.color) to.color.copy(from.color);
    to.needsUpdate = true;
  }

  function collectMaterials() {
    bucket.clear();
    sel.innerHTML = '';
    const added = new Set();

    viewer.scene.traverse(obj => {
      if (!(obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      mats.forEach(m => {
        if (!m) return;
        const key = ensureMatKey(m);
        if (!bucket.has(key)) bucket.set(key, new Set());
        bucket.get(key).add(m);
        if (!added.has(key)) {
          added.add(key);
          const opt = document.createElement('option');
          opt.value = key;
          opt.textContent = `${m.name || 'Material'} • ${m.type}`;
          sel.appendChild(opt);
        }
      });
    });

    if (sel.options.length > 0) syncUIFromFirstOf(sel.value);
  }

  function toUnlit(src) {
    if (src instanceof THREE.MeshBasicMaterial) return src;
    const basic = new THREE.MeshBasicMaterial();
    basic.userData = { ...(src.userData||{}), __origMat: src, __matKey: src.userData.__matKey };
    copyCommonProps(src, basic);
    return basic;
  }

  function fromUnlit(src) {
    return src?.userData?.__origMat || src;
  }

  function applyWhiteToAlpha(mat, enabled, threshold) {
    const prev = !!mat.userData.__w2a;
    if (!enabled && !prev) return;
    if (enabled) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
            if (all(greaterThanEqual(diffuseColor.rgb, vec3(${threshold.toFixed(3)})))) discard;
            #include <dithering_fragment>
          `
        );
      };
      mat.userData.__w2a = true;
    } else {
      mat.onBeforeCompile = null;
      mat.userData.__w2a = false;
    }
    mat.needsUpdate = true;
  }

  function syncUIFromFirstOf(matKey) {
    const set = bucket.get(matKey);
    if (!set || set.size === 0) return;
    const m = [...set][0];

    const c = m.color ? m.color.clone() : new THREE.Color(1,1,1);
    const hsl = {}; c.getHSL(hsl);
    h.value = Math.round(hsl.h * 360);
    s.value = Math.round(hsl.s * 100);
    l.value = Math.round(hsl.l * 100);
    o.value = (typeof m.opacity === 'number') ? m.opacity : 1;
    unlit.checked = (m instanceof THREE.MeshBasicMaterial) && !!m.userData.__origMat;
    w2a.checked = !!m.userData.__w2a;
  }

  function applyAll() {
    const key = sel.value;
    if (!key) return;

    const want = {
      h: parseFloat(h.value)/360,
      s: parseFloat(s.value)/100,
      l: parseFloat(l.value)/100,
      o: parseFloat(o.value),
      un: !!unlit.checked,
      w:  !!w2a.checked,
      t:  parseFloat(th.value)
    };

    viewer.scene.traverse(obj => {
      if (!(obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let changed = false;

      const newMats = mats.map(m => {
        if (!m || ensureMatKey(m) !== key) return m;

        let target = m;
        if (want.un) {
          target = toUnlit(m);
        } else if (m instanceof THREE.MeshBasicMaterial) {
          target = fromUnlit(m);
        }

        if (target.color?.setHSL) target.color.setHSL(want.h, want.s, want.l);
        if (typeof want.o === 'number' && !Number.isNaN(want.o)) {
          target.transparent = true;
          target.opacity = want.o;
        }
        applyWhiteToAlpha(target, want.w, want.t);

        ensureMatKey(target);
        if (target !== m) changed = true;
        return target;
      });

      if (changed) obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
    });

    collectMaterials();
    sel.value = key;
    syncUIFromFirstOf(key);
  }

  [h,s,l,o,unlit,w2a,th].forEach(el => el.addEventListener('input', applyAll));
  sel.addEventListener('change', () => { syncUIFromFirstOf(sel.value); });

  bus.on('model:loaded', collectMaterials);

  wrap.style.display = 'block';
  collectMaterials();
}
