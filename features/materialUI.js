// features/materialUI.js (v6.5.3)
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

      <div class="hint" style="color:#aaa;font-size:11px;">Tip: Unlit を OFF にすると元のマテリアルへ復帰します。</div>
      <button id="mat-refresh" style="background:#1e1e1e;color:#fff;border:1px solid #333;border-radius:8px;padding:6px 10px;cursor:pointer;">Refresh materials</button>
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
  const btnRefresh = wrap.querySelector('#mat-refresh');

  // id -> material
  const matMap = new Map();

  function collectMaterials() {
    matMap.clear();
    sel.innerHTML = '';
    const seen = new Set();
    const items = [];

    viewer.scene.traverse((obj) => {
      if (obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach((m) => {
          if (!m || !m.uuid || seen.has(m.uuid)) return;
          seen.add(m.uuid);
          const label = `${m.name || 'Material'} • ${m.type}`;
          items.push({ id: m.uuid, label, material: m });
        });
      }
    });

    // UIへ反映
    for (const it of items) {
      matMap.set(it.id, it.material);
      const opt = document.createElement('option');
      opt.value = it.id;
      opt.textContent = it.label;
      sel.appendChild(opt);
    }
  }

  function getSelectedMaterial() {
    const id = sel.value;
    return matMap.get(id) || null;
  }

  function ensureOriginal(mat) {
    if (!mat) return mat;
    if (!mat.__origMat && mat.userData && mat.userData.__origMat) {
      mat.__origMat = mat.userData.__origMat;
    }
    return mat;
  }

  function toUnlit(meshMat) {
    if (!meshMat) return meshMat;
    if (meshMat instanceof THREE.MeshBasicMaterial) return meshMat;
    const basic = new THREE.MeshBasicMaterial({
      color: meshMat.color?.clone?.() || new THREE.Color(1, 1, 1),
      transparent: true,
      opacity: ('opacity' in meshMat ? meshMat.opacity : 1),
    });
    basic.__origMat = meshMat;
    basic.userData.__origMat = meshMat;
    return basic;
  }

  function fromUnlit(meshMat) {
    if (!meshMat) return meshMat;
    const orig = meshMat.__origMat || meshMat.userData?.__origMat;
    return orig || meshMat;
  }

  function applyWhiteToAlpha(mat, enabled, threshold) {
    if (enabled) {
      mat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <dithering_fragment>',
          `
            // white-to-alpha
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
    const base = ensureOriginal(getSelectedMaterial());
    if (!base) return;

    const want = {
      h: parseFloat(h.value) / 360,
      s: parseFloat(s.value) / 100,
      l: parseFloat(l.value) / 100,
      o: parseFloat(o.value),
      w2a: w2a.checked,
      th: parseFloat(th.value),
      un: unlit.checked,
    };

    // 選ばれた material インスタンスを使っている Mesh 全てに反映
    viewer.scene.traverse((obj) => {
      if (!(obj && (obj.isMesh || obj.isSkinnedMesh) && obj.material)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      let changed = false;
      const newMats = mats.map((m) => {
        if (!m || m.uuid !== sel.value) return m;

        let target = m;
        if (want.un) {
          target = toUnlit(m);
        } else if (m instanceof THREE.MeshBasicMaterial) {
          target = fromUnlit(m);
        }

        if (target.color && target.color.setHSL) {
          target.color.setHSL(want.h, want.s, want.l);
        }
        target.transparent = true;
        target.opacity = want.o;

        applyWhiteToAlpha(target, want.w2a, want.th);

        changed = changed || (target !== m);
        return target;
      });

      if (changed) {
        obj.material = Array.isArray(obj.material) ? newMats : newMats[0];
      }
    });
  }

  [h, s, l, o, unlit, w2a, th].forEach((el) => el.addEventListener('input', applyAll));
  sel.addEventListener('change', applyAll);
  btnRefresh.addEventListener('click', () => { collectMaterials(); applyAll(); });

  // モデルロードで一覧更新
  bus.on('model:loaded', () => { collectMaterials(); });

  // 初期表示
  wrap.style.display = 'block';
  collectMaterials();
}
