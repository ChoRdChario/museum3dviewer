// material.runtime.patch.js
// LociMyu runtime material patch
// Adds Chroma key support on top of viewer.module.cdn.js
// VERSION_TAG: mat-rt v3.3 (chroma key)

(function () {
  const TAG = '[mat-rt v3.3]';

  function log() {
    console.log.apply(console, [TAG].concat(Array.from(arguments)));
  }
  function warn() {
    console.warn.apply(console, [TAG].concat(Array.from(arguments)));
  }

  // --- small helpers ---

  function hexToColor(hex) {
    if (!hex) return { r: 0, g: 0, b: 0 };
    let h = String(hex).trim();
    if (h[0] === '#') h = h.slice(1);
    if (h.length === 3) {
      h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    const num = parseInt(h, 16);
    if (isNaN(num)) {
      return { r: 0, g: 0, b: 0 };
    }
    return {
      r: ((num >> 16) & 255) / 255,
      g: ((num >> 8) & 255) / 255,
      b: (num & 255) / 255
    };
  }

  function clamp01(v) {
    v = Number(v);
    if (!isFinite(v)) return 0;
    if (v < 0) return 0;
    if (v > 1) return 1;
    return v;
  }

  function findSceneFromBridge(bridge) {
    try {
      if (bridge && typeof bridge.getScene === 'function') {
        return bridge.getScene();
      }
    } catch (_) {}
    return null;
  }

  function forEachMaterialInScene(scene, fn) {
    if (!scene || typeof scene.traverse !== 'function') return;
    scene.traverse(function (obj) {
      const mat = obj.material;
      if (!mat) return;
      if (Array.isArray(mat)) {
        mat.forEach(function (m) { if (m && m.isMaterial) fn(m, obj); });
      } else if (mat.isMaterial) {
        fn(mat, obj);
      }
    });
  }

  function matchMaterialName(targetKey, material) {
    if (!targetKey || !material) return false;
    const key = String(targetKey);
    // typical pattern: material.name === key
    if (String(material.name) === key) return true;
    // Some pipelines prefix with mesh name; allow suffix match as a fallback
    if (material.name && material.name.endsWith('::' + key)) return true;
    return false;
  }

  // --- chroma key patching ---

  function ensureChromaPatched(material) {
    if (!material.userData) material.userData = {};
    if (material.userData.__lm_chroma_patched) {
      return;
    }
    material.userData.__lm_chroma_patched = true;
    material.userData.__lm_chroma_origOnBeforeCompile = material.onBeforeCompile || null;

    material.onBeforeCompile = function (shader) {
      // call original hook first, if any
      if (typeof material.userData.__lm_chroma_origOnBeforeCompile === 'function') {
        material.userData.__lm_chroma_origOnBeforeCompile(shader);
      }

      const params = material.userData.__lm_chroma_params || {};
      const color = params.color || { r: 0, g: 0, b: 0 };
      const tol = params.enable ? params.tol || 0 : 0;
      const feather = params.enable ? params.feather || 0 : 0;

      const T = window.THREE;

      // uniforms
      shader.uniforms.lmChromaKeyColor = {
        value: T && T.Color ? new T.Color(color.r, color.g, color.b) : { r: color.r, g: color.g, b: color.b }
      };
      shader.uniforms.lmChromaTolerance = { value: tol };
      shader.uniforms.lmChromaFeather = { value: feather };

      // header
      shader.fragmentShader =
        'uniform vec3 lmChromaKeyColor;\\n' +
        'uniform float lmChromaTolerance;\\n' +
        'uniform float lmChromaFeather;\\n' +
        shader.fragmentShader;

      // body injection: replace final color write
      shader.fragmentShader = shader.fragmentShader.replace(
        'gl_FragColor = vec4( outgoingLight, diffuseColor.a );',
        [
          'vec4 lm_color = vec4( outgoingLight, diffuseColor.a );',
          'float lm_d = distance( lm_color.rgb, lmChromaKeyColor );',
          'float lm_alpha = lm_color.a;',
          'if (lmChromaTolerance > 0.0) {',
          '  float edge0 = max(lmChromaTolerance - lmChromaFeather, 0.0);',
          '  float edge1 = lmChromaTolerance + lmChromaFeather;',
          '  float k = smoothstep(edge0, edge1, lm_d);',
          '  lm_alpha *= k;',
          '}',
          'if (lm_alpha <= 0.001) discard;',
          'gl_FragColor = vec4( lm_color.rgb, lm_alpha );'
        ].join('\\n')
      );

      material.userData.__lm_chroma_shader = shader;
    };
  }

  function updateChromaUniforms(material, colorHex, tol, feather, enable) {
    if (!material) return;
    if (!material.userData) material.userData = {};

    const rgb = hexToColor(colorHex);

    material.userData.__lm_chroma_params = {
      enable: !!enable && tol > 0,
      color: rgb,
      tol: clamp01(tol),
      feather: clamp01(feather)
    };

    // ensure hook installed
    ensureChromaPatched(material);

    const shader = material.userData.__lm_chroma_shader;
    const params = material.userData.__lm_chroma_params;

    if (shader && shader.uniforms) {
      const T = window.THREE;
      const c = params.color;

      if (shader.uniforms.lmChromaKeyColor) {
        if (T && T.Color && shader.uniforms.lmChromaKeyColor.value && shader.uniforms.lmChromaKeyColor.value.isColor) {
          shader.uniforms.lmChromaKeyColor.value.setRGB(c.r, c.g, c.b);
        } else {
          shader.uniforms.lmChromaKeyColor.value = T && T.Color
            ? new T.Color(c.r, c.g, c.b)
            : { r: c.r, g: c.g, b: c.b };
        }
      }

      if (shader.uniforms.lmChromaTolerance) {
        shader.uniforms.lmChromaTolerance.value = params.enable ? params.tol : 0.0;
      }
      if (shader.uniforms.lmChromaFeather) {
        shader.uniforms.lmChromaFeather.value = params.enable ? params.feather : 0.0;
      }
    }

    // enable transparency when chroma is active
    material.transparent = !!params.enable || material.transparent;
    material.needsUpdate = true;
  }

  function applyChromaForKey(bridge, key, props) {
    const scene = findSceneFromBridge(bridge) || window.__LM_SCENE || window.scene || null;
    if (!scene) {
      warn('no scene for chroma key');
      return;
    }
    const enable = !!props.chromaEnable;
    const tol = clamp01(props.chromaTolerance || 0);
    const feather = clamp01(props.chromaFeather || 0);
    const colorHex = props.chromaColor || '#000000';

    forEachMaterialInScene(scene, function (mat /*, obj */) {
      if (!matchMaterialName(key, mat)) return;
      updateChromaUniforms(mat, colorHex, tol, feather, enable);
    });
  }

  // global hook so orchestrator can call directly
  window.__lm_applyChromaForKey = function (materialKey, props) {
    try {
      const bridge = window.__lm_viewer_bridge || window.viewerBridge || null;
      applyChromaForKey(bridge, materialKey, props || {});
    } catch (e) {
      warn('global chroma apply error', e);
    }
  };

  // --- patch viewer bridge ---

  function install() {
    const bridge = window.__lm_viewer_bridge || window.viewerBridge || null;
    if (!bridge || typeof bridge.applyMaterialProps !== 'function') {
      return false;
    }

    if (bridge.__lm_chroma_wrapped) {
      return true;
    }
    bridge.__lm_chroma_wrapped = true;

    const origApply = bridge.applyMaterialProps.bind(bridge);

    bridge.applyMaterialProps = function (key, props) {
      try {
        // まずオリジナルの適用（opacity / doubleSided / unlit など）
        origApply(key, props);
      } catch (e) {
        warn('orig applyMaterialProps error', e);
      }

      try {
        if (props && (props.chromaEnable !== undefined ||
                      props.chromaColor !== undefined ||
                      props.chromaTolerance !== undefined ||
                      props.chromaFeather !== undefined)) {
          applyChromaForKey(bridge, key, props);
        }
      } catch (e) {
        warn('chroma apply error', e);
      }
    };

    log('patched viewer bridge for chroma key');
    return true;
  }

  function waitAndInstall() {
    if (!install()) {
      // retry a few times while viewer.module initializes
      let tries = 0;
      const timer = setInterval(function () {
        tries++;
        if (install() || tries > 30) {
          clearInterval(timer);
        }
      }, 500);
    }
  }

  // kick
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInstall);
  } else {
    waitAndInstall();
  }

  log('ready');
})();
