/* material.dropdown.patch.js v3.4
 * Purpose: Populate #pm-material with scene material names AFTER GLB is loaded,
 *          excluding auto-generated/UUID-like names. Idempotent & safe to re-run.
 * Logs: [mat-dd v3.4] ...
 */
(function () {
  const TAG = '[mat-dd v3.4]';
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const THREE_AUTO_RE = /^(?:Mesh)?(?:Basic|Lambert|Phong|Standard|Physical|Toon)Material$/i;

  // Run once guard for wiring listeners (not for refresh function)
  if (window.__LM_MAT_DD_WIRED__) {
    // already wired; still expose refresh function below
  } else {
    window.addEventListener('lm:glb-detected', () => {
      // small delay to allow viewer.bridge to finalize scene refs
      setTimeout(refreshDropdown, 0);
    });
    // If scene is already there (hot reload / cache), try once on DOMContentLoaded
    if (document.readyState !== 'loading') {
      setTimeout(() => window.__LM_SCENE && refreshDropdown(), 0);
    } else {
      document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => window.__LM_SCENE && refreshDropdown(), 0);
      });
    }
    window.__LM_MAT_DD_WIRED__ = true;
  }

  function collectMaterialNames() {
    const scene = window.__LM_SCENE || (window.viewer && window.viewer.scene);
    if (!scene) return [];
    const set = new Set();
    scene.traverse(o => {
      if (!o.isMesh || !o.material) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        let name = (m && m.name || '').trim();
        if (!name) continue;
        if (UUID_RE.test(name)) continue;
        if (THREE_AUTO_RE.test(name)) continue;
        set.add(name);
      }
    });
    return Array.from(set).sort((a,b)=> a.localeCompare(b));
  }

  function refreshDropdown() {
    try {
      const dd = document.getElementById('pm-material') || document.getElementById('mat-select') || document.querySelector('#pm-opacity select, #panel-material select');
      if (!dd) {
        console.warn(TAG, 'dropdown element not found');
        return;
      }
      const names = collectMaterialNames();
      // rebuild options from scratch
      dd.innerHTML = '';
      const ph = document.createElement('option');
      ph.value = '';
      ph.textContent = '— Select material —';
      dd.appendChild(ph);
      for (const n of names) {
        const opt = document.createElement('option');
        opt.value = n;
        opt.textContent = n;
        dd.appendChild(opt);
      }
      console.log(TAG, 'populated', names.length);
      // If the current value no longer exists, reset to placeholder
      if (!names.includes(dd.value)) dd.value = '';
      // Fire a change so orchestrator can pull latest
      dd.dispatchEvent(new Event('change', { bubbles: true }));
    } catch (e) {
      console.error(TAG, 'refresh failed', e);
    }
  }

  // Expose manual refresher for debugging
  window.__LM_MAT_DD_REFRESH__ = refreshDropdown;
})();
