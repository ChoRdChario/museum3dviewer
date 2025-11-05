
/**
 * material.ui.populate.bridgepatch.js (v1.1)
 * Purpose: Populate the per‑material <select> with materials from the THREE.Scene.
 * More tolerant scene detection:
 *  - getScene() may return the Scene itself or an object containing {scene}.
 *  - Waits for a non-empty scene graph (has at least 1 Mesh with a material).
 *  - Listens to multiple custom events and also performs a bounded retry loop.
 */
(() => {
  const TAG = '[populate-bridgepatch]';
  const log = (...a) => console.log('%c'+TAG, 'color:#0bf', ...a);

  // --- Config ---
  const MAX_TRIES = 120;      // 120 * 100ms = 12s
  const INTERVAL_MS = 100;

  // --- Helpers ---
  function getSelectEl() {
    return document.querySelector('#pm-material')
        || document.querySelector('#materialSelect')
        || document.querySelector('select[name="materialKey"]')
        || document.querySelector('[data-lm="material-select"]')
        || document.querySelector('.lm-material-select')
        || document.querySelector('#materialPanel select')
        || document.querySelector('.material-panel select');
  }

  function resolveSceneCandidate() {
    try {
      const getter =
        (window.lm && typeof window.lm.getScene === 'function' && window.lm.getScene) ||
        (typeof window.getScene === 'function' && window.getScene) ||
        null;
      if (!getter) return null;
      const candidate = getter();
      // Candidate may be the Scene itself, or an object containing it.
      if (candidate && candidate.isScene) return candidate;
      if (candidate && candidate.scene && candidate.scene.isScene) return candidate.scene;
      // Some wrappers use { viewer, three: { scene } }
      if (candidate && candidate.three && candidate.three.scene && candidate.three.scene.isScene) {
        return candidate.three.scene;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  function harvestMaterials(scene) {
    const map = new Map(); // name -> {count, uuidSet}
    scene.traverse(obj => {
      const m = obj.material;
      if (!m) return;
      const arr = Array.isArray(m) ? m : [m];
      arr.forEach(mm => {
        if (!mm) return;
        const name = (mm.name && String(mm.name)) || '(no-name)';
        if (!map.has(name)) map.set(name, { count: 0, uuidSet: new Set() });
        const rec = map.get(name);
        rec.count += 1;
        if (mm.uuid) rec.uuidSet.add(mm.uuid);
      });
    });
    // Convert to array, filter out zero (shouldn't happen), sort by uses desc then alpha.
    return Array.from(map.entries())
      .filter(([, rec]) => rec.count > 0)
      .sort((a, b) => (b[1].count - a[1].count) || a[0].localeCompare(b[0]))
      .map(([name, rec]) => ({ name, uses: rec.count, distinct: rec.uuidSet.size }));
  }

  function populateSelect(list) {
    const sel = getSelectEl();
    if (!sel) return false;
    // Keep first placeholder option (if any).
    const first = sel.options[0] && !sel.options[0].value ? sel.options[0] : null;
    sel.innerHTML = '';
    if (first) sel.appendChild(first);
    list.forEach(item => {
      const opt = document.createElement('option');
      opt.value = item.name;
      // Show occurrences when duplicated names exist.
      opt.textContent = item.distinct > 1 || item.uses > 1
        ? `${item.name} (x${item.uses})`
        : item.name;
      sel.appendChild(opt);
    });
    // Announce once populated.
    const detail = { count: list.length, reason: 'populated' };
    window.dispatchEvent(new CustomEvent('pm:materials-populated', { detail }));
    log('populated', detail);
    return true;
  }

  // Expose manual kick (idempotent safe).
  window.__pm_populate = window.__pm_populate || {};
  window.__pm_populate.tryPopulateOnce = (reason = 'manual') => attemptPopulate(reason, true);

  let trying = false;
  let attemptId = 0;

  async function attemptPopulate(reason = 'auto', singleShot = false) {
    if (trying) return;
    trying = true;
    attemptId++;
    const tried = [];
    for (let i = 0; i < MAX_TRIES; i++) {
      const sel = getSelectEl();
      const scene = resolveSceneCandidate();
      tried.push({ hasScene: !!scene, hasSelect: !!sel });
      if (sel && scene) {
        // Scene must contain at least one mesh with material to be meaningful.
        const list = harvestMaterials(scene);
        if (list.length > 0) {
          populateSelect(list);
          trying = false;
          return true;
        }
      }
      if (singleShot) break;
      await new Promise(r => setTimeout(r, INTERVAL_MS));
    }
    log('done, reason=', 'timeout', 'tried=', tried);
    trying = false;
    return false;
  }

  // Boot: listen a bunch of plausible hooks.
  ['DOMContentLoaded', 'load', 'lm:scene-ready', 'lm:scene-stable', 'lm:viewer-ready']
    .forEach(ev => window.addEventListener(ev, () => attemptPopulate(ev, false), { once: false }));

  // Also attempt shortly after init (defer so other modules run first).
  setTimeout(() => attemptPopulate('defer-init', false), 50);

  log('script initialized');
})();
