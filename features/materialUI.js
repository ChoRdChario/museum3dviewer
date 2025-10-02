// features/materialUI.js (v6.5.5-1) — fix: onBeforeCompile null → noop to avoid customProgramCacheKey crash
import * as THREE from 'three';

let MAT_KEY_SEQ = 1;

export function mountMaterialUI({ bus, viewer }) {
  const sidePane = document.getElementById('side');
  if (!sidePane) return;

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

      <div style="display:grid;gap:6px;">
        <label><input id="mat-unlit" type="checkbox"> Unlit (ignore lights)</label>
        <label><input id="mat-doubleside" type="checkbox"> Double-sided (draw backfaces)</label>
      </div>

      <div>
        <label style="display:flex;align-items:center;gap:8px">
          <input id="mat-w2a" type="checkbox"> White → Transparent
        </label>
        <input id="mat-th" type="range" min="0.85" max="1" step="0.005" value="0.98">
        <small style="color:#9aa">閾値↑（白に近いほど透過）</small>
      </div>
    </div>
  `;
  sidePane.appendChild(wrap);

  const sel = wrap.querySelector('#mat-target');
  const h = wrap.querySelector('#mat-h');
  const s = wrap.querySelector('#mat-s');
  const l = wrap.querySelector('#mat-l');
  const o = wrap.querySelector('#mat-o');
  const unlit = wrap.querySelector('#mat-unlit');
  const doubleside = wrap.querySelector('#mat-doubleside');
  const w2a = wrap.querySelector('#mat-w2a');
  const th = wrap.querySelector('#mat-th');

  const bucket = new Map();

  function ensureMatKey(m) {
    m.userData ||= {};
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
    if (from.userData?.__w2a) {
      ensureWhiteUniform(to, from.userData.__whiteUniform?.value ?? 0.98);
    } else {
      to.onBeforeCompile = (/*shader*/)=>{}; // null禁止
    }
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
        (bucket.get(key) || bucket.set(key, new Set()).get(key)).add(m);
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
  const fromUnlit = (src) => src?.userData?.__origMat || src;

  function ensureWhiteUniform(mat, threshold) {
    mat.userData ||= {};
    mat.userData.__w2a = true;
    mat.userData.__whiteUniform = mat.userData.__whiteUniform || { value: threshold };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWhiteThreshold = mat.userData.__whiteUniform;
      const code = `
        float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
        if (lum >= uWhiteThreshold) discard;
      `;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <dithering_fragment>',
        `${code}
         #include <dithering_fragment>`
      );
    };
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.alphaTest = 0.0;
    mat.blending = THREE.NormalBlending;
    mat.needsUpdate = true;
  }
  function disableWhite(mat) {
    if (!mat) return;
    mat.userData ||= {};
    mat.userData.__w2a = false;
    mat.onBeforeCompile = (/*shader*/)=>{}; // ★ no-op
    mat.needsUpdate = true;
    if (!mat.transparent) mat.depthWrite = true;
  }

  function applySide(mat, isDouble) {
    mat.side = isDouble ? THREE.DoubleSide : THREE.FrontSide;
    mat.needsUpdate = true;
  }

  function bumpRenderOrderForMatKey(matKey, order = 2) {
    viewer.scene.traverse(obj => {
      if (!(obj?.isMesh || obj?.isSkinnedMesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      if (mats.some(m => m && m.userData && m.userData.__matKey === matKey)) {
        obj.renderOrder = order;
      }
    });
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
    if (m.userData?.__whiteUniform) th.value = m.userData.__whiteUniform.value.toFixed(3);
    doubleside.checked = (m.side === THREE.DoubleSide);
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
      ds: !!doubleside.checked,
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
        if (want.un) target = toUnlit(m);
        else if (m instanceof THREE.MeshBasicMaterial) target = fromUnlit(m);

        if (target.color?.setHSL) target.color.setHSL(want.h, want.s, want.l);
        if (typeof want.o === 'number' && !Number.isNaN(want.o)) {
          target.transparent = (want.o < 1) || want.w;
          target.opacity = want.o;
        }
        applySide(target, want.ds);

        if (want.w) {
          ensureWhiteUniform(target, want.t);
          if (target.userData?.__whiteUniform) target.userData.__whiteUniform.value = want.t;
        } else {
          disableWhite(target);
        }

        ensureMatKey(target);
        if (target !== m) changed = true;
        return target;
      });

      if (changed) obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
    });

    bumpRenderOrderForMatKey(key, (w2a.checked || parseFloat(o.value) < 1) ? 2 : 0);
    syncUIFromFirstOf(key);
  }

  [h,s,l,o,unlit,doubleside,w2a,th].forEach(el => el.addEventListener('input', applyAll));
  sel.addEventListener('change', () => { syncUIFromFirstOf(sel.value); });

  bus.on('model:loaded', collectMaterials);
  wrap.style.display = 'block';
  collectMaterials();
}
