\
    // material.orchestrator.js — Step2 safe extension
    // - One-shot populate material names after lm:scene-ready (no busy loop)
    // - Preserve opacity application path
    // - Add listeners for chroma/unlit/double-sided (shader patching comes later)

    const LOG = /[?&]debug=1/.test(location.search);
    const log = (...a)=>{ if (LOG) console.log("[mat-orch]", ...a); };

    let filledOnce = false;

    function listNamesFromScene() {
      const s = window.__LM_SCENE, set = new Set();
      s?.traverse(o => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m?.name && set.add(m.name));
      });
      return [...set].filter(n => !/^#\d+$/.test(n));
    }

    function dispatchSetMaterials() {
      if (filledOnce) return;
      const names = listNamesFromScene();
      if (!names.length) return;
      filledOnce = true;
      document.dispatchEvent(new CustomEvent('pm:set-materials', { detail: { names } }));
      log("dispatch pm:set-materials", names);
    }

    // Scene ready → short backoff poll to catch GLB finishing moments later
    document.addEventListener('lm:scene-ready', () => {
      let tries = 0;
      const timer = setInterval(() => {
        dispatchSetMaterials();
        if (filledOnce || ++tries > 25) clearInterval(timer); // ~5s max
      }, 200);
    });

    // -------- Opacity (existing behavior) --------
    document.addEventListener('pm:opacity-change', (e) => {
      const d = e?.detail || {};
      const name = d.name || "";
      if (!name) return;
      const v = Math.max(0, Math.min(1, Number(d.opacity ?? 1)));
      let count = 0;

      const modApplyByName = (window.LM_viewer && window.LM_viewer.applyMaterialPropsByName) || null;
      if (modApplyByName) {
        try { count = modApplyByName(name, { opacity: v }); } catch {}
      } else {
        // fallback: write directly
        const s = window.__LM_SCENE;
        s?.traverse(o => {
          if (!o.isMesh || !o.material) return;
          (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
            if ((m?.name||"") === name) {
              m.transparent = v < 1;
              m.opacity = v;
              m.depthWrite = v >= 1;
              m.needsUpdate = true;
              count++;
            }
          });
        });
      }
      log("opacity applied", name, v, "count", count);
    });

    // -------- Step2 additions: chroma & flags (safe, state in userData) --------
    document.addEventListener('pm:chroma-change', (e) => {
      const d = e?.detail || {};
      const name = d.name || '';
      if (!name) return;
      let count = 0;
      const s = window.__LM_SCENE;
      s?.traverse(o => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if ((m?.name||'') === name) {
            m.userData = m.userData || {};
            m.userData.chroma = {
              enabled: !!d.enabled,
              color: String(d.color || '#ffffff'),
              tolerance: Number(d.tolerance || 0),
              feather: Number(d.feather || 0),
            };
            m.needsUpdate = true;
            count++;
          }
        });
      });
      log("chroma saved", name, d, "count", count);
    });

    document.addEventListener('pm:flag-change', (e) => {
      const d = e?.detail || {};
      const name = d.name || '';
      if (!name) return;
      let count = 0;
      const THREE = window.THREE;
      const s = window.__LM_SCENE;
      s?.traverse(o => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
          if ((m?.name||'') === name) {
            if ('doubleSided' in d && THREE) {
              m.side = d.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
            }
            if ('unlitLike' in d) {
              m.userData = m.userData || {};
              m.userData.unlitLike = !!d.unlitLike;
              if (typeof m.metalness === 'number') m.metalness = d.unlitLike ? 0.0 : m.metalness;
              if (typeof m.roughness === 'number') m.roughness = d.unlitLike ? 1.0 : m.roughness;
            }
            m.needsUpdate = true;
            count++;
          }
        });
      });
      log("flags applied", name, d, "count", count);
    });

    export {};
