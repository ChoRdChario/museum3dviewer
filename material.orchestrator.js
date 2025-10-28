
/**
 * LociMyu Material Orchestrator (Step2)
 * - Populates material list after model-ready
 * - Per-material opacity (immediate preview)
 * - Flags: Unlit-like / Double-sided
 * - Chroma key: arbitrary color + tolerance + feather
 * Notes:
 * - No console spam; single-line status logs at INFO level.
 * - Works without modifying viewer.module.cdn.js (uses scene traversal).
 */

const LM = (() => {
  const state = {
    wired: false,
    lastNames: [],
  };

  const $ = (id) => document.getElementById(id);

  // ---- Scene helpers ----
  function getScene() {
    return (window.__LM_SCENE || null);
  }

  function listMaterialNamesFromScene() {
    const s = getScene();
    const set = new Set();
    s?.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.name && set.add(m.name));
    });
    return [...set].filter(n => !/^#\d+$/.test(n));
  }

  function forEachMaterialByName(name, fn) {
    const s = getScene();
    if (!s || !name) return 0;
    let count = 0;
    s.traverse(o => {
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
        if ((m?.name || '') === name) {
          try { fn(m); count++; } catch {}
        }
      });
    });
    return count;
  }

  // ---- Per-material opacity ----
  function applyOpacityByName(name, v) {
    v = Math.max(0, Math.min(1, Number(v)));
    return forEachMaterialByName(name, (m) => {
      m.transparent = v < 1;
      m.opacity = v;
      m.depthWrite = !m.transparent;
      m.needsUpdate = true;
    });
  }

  function getOpacityByName(name) {
    let val = null;
    forEachMaterialByName(name, (m) => {
      if (val == null) val = Number(m.opacity ?? 1);
    });
    return (val == null ? 1 : Math.max(0, Math.min(1, val)));
  }

  // ---- Flags: double-sided / unlit-like ----
  function applyFlagsByName(name, { doubleSided, unlitLike } = {}) {
    return forEachMaterialByName(name, (m) => {
      if (typeof doubleSided === 'boolean') {
        const THREE_ = window.THREE;
        if (THREE_) {
          m.side = doubleSided ? THREE_.DoubleSide : THREE_.FrontSide;
        }
        m.needsUpdate = true;
      }
      if (typeof unlitLike === 'boolean') {
        // patch fragment to favor diffuseColor.rgb
        if (!m.userData.__lm_unlit_patched) {
          const prev = m.onBeforeCompile;
          m.onBeforeCompile = (shader) => {
            prev && prev(shader);
            shader.fragmentShader = shader.fragmentShader.replace(
              /gl_FragColor\s*=\s*vec4\(\s*outgoingLight\s*,\s*diffuseColor\.a\s*\)\s*;/,
              `
              // LM_UNLIT hook
              outgoingLight = diffuseColor.rgb;
              gl_FragColor = vec4(outgoingLight, diffuseColor.a);
              `
            );
            m.userData.__lm_unlit_shader = shader;
          };
          m.userData.__lm_unlit_patched = true;
        }
        m.userData.__lm_unlit_enabled = !!unlitLike;
        m.needsUpdate = true;
      }
    });
  }

  // ---- Chroma key ----
  function hexToRgb01(hex = '#00ff00') {
    const s = hex.replace('#', '');
    const full = s.length === 3 ? s.split('').map(c => c + c).join('') : s;
    const n = parseInt(full || '00ff00', 16);
    return [(n >> 16 & 255)/255, (n >> 8 & 255)/255, (n & 255)/255];
  }

  function applyChromaByName(name, { enabled, colorHex = '#00ff00', tol = 0.15, feather = 0.10 } = {}) {
    const [r,g,b] = hexToRgb01(colorHex);
    return forEachMaterialByName(name, (m) => {
      if (!m.userData.__lm_chroma_patched) {
        const prev = m.onBeforeCompile;
        m.onBeforeCompile = (shader) => {
          prev && prev(shader);
          shader.uniforms.LM_ChromaEnabled = { value: 0 };
          shader.uniforms.LM_ChromaColor   = { value: new (window.THREE?.Color || function(){}) (1,1,1) };
          shader.uniforms.LM_ChromaTol     = { value: 0.15 };
          shader.uniforms.LM_ChromaFeather = { value: 0.10 };

          shader.fragmentShader = `
            uniform int LM_ChromaEnabled;
            uniform vec3 LM_ChromaColor;
            uniform float LM_ChromaTol;
            uniform float LM_ChromaFeather;
          ` + shader.fragmentShader;

          shader.fragmentShader = shader.fragmentShader.replace(
            /gl_FragColor\s*=\s*vec4\(\s*outgoingLight\s*,\s*diffuseColor\.a\s*\)\s*;/,
            `
              // LM_CHROMA hook
              if (LM_ChromaEnabled == 1) {
                float d = length( (diffuseColor.rgb) - LM_ChromaColor );
                float k = smoothstep(LM_ChromaTol, LM_ChromaTol + LM_ChromaFeather, d);
                diffuseColor.a *= k;
              }
              gl_FragColor = vec4(outgoingLight, diffuseColor.a);
            `
          );
          m.userData.__lm_chroma_shader = shader;
        };
        m.userData.__lm_chroma_patched = true;
      }
      const sh = m.userData.__lm_chroma_shader;
      if (sh && sh.uniforms && sh.uniforms.LM_ChromaColor && sh.uniforms.LM_ChromaColor.value?.setRGB) {
        sh.uniforms.LM_ChromaEnabled.value = enabled ? 1 : 0;
        sh.uniforms.LM_ChromaColor.value.setRGB(r,g,b);
        sh.uniforms.LM_ChromaTol.value = tol;
        sh.uniforms.LM_ChromaFeather.value = feather;
      }
      m.transparent = enabled || (m.opacity < 1.0);
      m.depthWrite  = !m.transparent;
      m.needsUpdate = true;
    });
  }

  // ---- UI ----
  function fillSelectOnce() {
    const sel = $('pm-material');
    if (!sel) return false;
    const names = listMaterialNamesFromScene();
    if (!names.length) return false;

    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select material —</option>';
    names.forEach(n => {
      const o = document.createElement('option');
      o.value = n; o.textContent = n; sel.appendChild(o);
    });
    if (cur && names.includes(cur)) sel.value = cur;
    state.lastNames = names;
    console.info('[lm-orch] filled', names.length, names);
    return true;
  }

  function wireUI() {
    if (state.wired) return;
    const sel = $('pm-material');
    const permat = $('pm-permat-range');
    const permatOut = $('pm-permat-val');

    const unlit = $('pm-unlit');
    const dside = $('pm-doublesided');

    const ckEnable = $('pm-chroma-enable');
    const ckColor  = $('pm-chroma-color');
    const ckTol    = $('pm-chroma-tol');
    const ckFea    = $('pm-chroma-feather');

    // opacity
    permat?.addEventListener?.('input', () => {
      const n = sel?.value || '';
      if (!n) return;
      const v = Number(permat.value || 1);
      permatOut.textContent = v.toFixed(2);
      applyOpacityByName(n, v);
    }, { passive: true });

    // flags
    const applyFlags = () => {
      const n = sel?.value || '';
      if (!n) return;
      applyFlagsByName(n, { unlitLike: !!unlit?.checked, doubleSided: !!dside?.checked });
    };
    unlit?.addEventListener('change', applyFlags);
    dside?.addEventListener('change', applyFlags);

    // chroma
    const applyChroma = () => {
      const n = sel?.value || '';
      if (!n) return;
      applyChromaByName(n, {
        enabled: !!ckEnable?.checked,
        colorHex: ckColor?.value || '#00ff00',
        tol: Number(ckTol?.value || 0.15),
        feather: Number(ckFea?.value || 0.10),
      });
    };
    ckEnable?.addEventListener('change', applyChroma);
    ckColor?.addEventListener('input', applyChroma, { passive: true });
    ckTol?.addEventListener('input', applyChroma, { passive: true });
    ckFea?.addEventListener('input', applyChroma, { passive: true });

    // selection sync
    sel?.addEventListener('change', () => {
      const n = sel.value;
      const v = n ? getOpacityByName(n) : 1;
      if (permat) permat.value = v;
      if (permatOut) permatOut.textContent = v.toFixed(2);
      applyFlags();
      applyChroma();
    });

    state.wired = true;
  }

  // ---- Orchestration ----
  function onSceneReady() {
    console.info('[lm-orch] scene-ready');
    // Model-ready が来るまで待つ（viewer.bridge.module.js が投げてくれる）
  }

  function onModelReady() {
    console.info('[lm-orch] model-ready');
    // material list を一回だけ埋める（空なら短期ポーリング）
    wireUI();
    if (fillSelectOnce()) return;
    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (fillSelectOnce() || tries >= 30) clearInterval(t);
    }, 200);
  }

  // listeners
  document.addEventListener('lm:scene-ready', onSceneReady, { once: true });
  document.addEventListener('lm:model-ready', onModelReady, { once: true });

  // one-shot status log
  console.info('[lm-orch] loaded');

  return { listMaterialNamesFromScene, applyOpacityByName, applyFlagsByName, applyChromaByName };
})();

export default LM;
