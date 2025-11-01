/* material.orchestrator.js
 * VERSION_TAG: V6_15h_BRIDGE_WAIT_ROBUST
 * See in-chat notes for behavior.
 */
(function () {
  const VERSION_TAG = 'V6_15h_BRIDGE_WAIT_ROBUST';
  const log = (...a) => console.log('[mat-orch]', ...a);
  const warn = (...a) => console.warn('[mat-orch]', ...a);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const nowISO = () => new Date().toISOString();

  async function waitForUI(timeoutMs = 8000) {
    const t0 = Date.now();
    let matSel = null, opacity = null;
    do {
      matSel = document.querySelector('#pm-material') ||
               document.querySelector('select#pm-material') ||
               document.querySelector('[data-role="pm-material"]') ||
               document.querySelector('select[data-mat]') ||
               (document.querySelectorAll('select').length > 1 ? document.querySelectorAll('select')[1] : null);
      opacity = document.querySelector('#pm-opacity') ||
                document.querySelector('input#pm-opacity[type="range"]') ||
                document.querySelector('input[type="range"][name="pm-opacity"]') ||
                document.querySelector('[data-role="pm-opacity"]') ||
                document.querySelector('input[type="range"]');
      if (matSel && opacity) return { matSel, opacity };
      await sleep(120);
    } while (Date.now() - t0 < timeoutMs);
    throw new Error('UI controls not found');
  }

  async function waitForBridges(timeoutMs = 12000) {
    const t0 = Date.now();
    do {
      const vb = window.viewerBridge;
      const sb = window.materialsSheetBridge;
      if (vb && typeof vb.listMaterials === 'function' && sb && typeof sb.loadAll === 'function' && typeof sb.upsertOne === 'function') {
        return { vb, sb };
      }
      await sleep(150);
    } while (Date.now() - t0 < timeoutMs);
    throw new Error('viewerBridge/materialsSheetBridge not ready');
  }

  async function applyOpacityToScene(vb, materialName, value) {
    try {
      if (typeof vb.applyMaterialOpacity === 'function') {
        vb.applyMaterialOpacity(materialName, value);
        return;
      }
      const mats = await vb.listMaterials();
      const targets = mats.filter(m => (m.name || m.material?.name || '').trim() === materialName);
      targets.forEach(m => {
        const mat = m.material || m;
        if (mat && 'opacity' in mat) {
          mat.transparent = value < 1.0 || mat.transparent === true;
          mat.opacity = value;
          if ('needsUpdate' in mat) mat.needsUpdate = true;
        }
      });
    } catch (e) {
      warn('applyOpacity fallback failed', e);
    }
  }

  function uniqueNames(list) {
    const seen = new Set(), out = [];
    for (const m of list) {
      const n = (m.name || m.material?.name || '').trim();
      if (!n || seen.has(n)) continue;
      seen.add(n); out.push(n);
    }
    return out.sort((a,b)=>a.localeCompare(b));
  }

  function debounce(fn, delay = 220) {
    let h = null;
    return function (...args) { clearTimeout(h); h = setTimeout(()=>fn.apply(this,args), delay); };
  }

  async function boot() {
    log('loaded VERSION_TAG:', VERSION_TAG);
    const { matSel, opacity } = await waitForUI();
    log('ui ok');
    const { vb, sb } = await waitForBridges();

    // Populate list
    const mats = await vb.listMaterials();
    const names = uniqueNames(mats);
    matSel.innerHTML = '';
    const opt0 = document.createElement('option');
    opt0.value = ''; opt0.textContent = '— Select material —';
    matSel.appendChild(opt0);
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n; matSel.appendChild(o);
    }
    log('panel populated', names.length, 'materials');

    // Load saved rows
    let saved = new Map();
    try {
      const rows = await sb.loadAll();
      for (const r of rows || []) {
        const key = (r.materialKey || r.name || '').trim();
        if (!key) continue;
        const prev = saved.get(key);
        if (!prev || (r.updatedAt || '') > (prev.updatedAt || '')) saved.set(key, r);
      }
    } catch (e) { warn('loadAll failed (continue with empty):', e); }

    // Apply saved to scene
    for (const [k, r] of saved.entries()) {
      const v = Number(r.opacity);
      if (!isNaN(v)) await applyOpacityToScene(vb, k, v);
    }

    function reflectUIFor(name) {
      const r = saved.get(name);
      const v = r ? Number(r.opacity) : 1.0;
      opacity.value = String(isNaN(v) ? 1.0 : v);
      opacity.dispatchEvent(new Event('input', { bubbles: true }));
    }

    matSel.addEventListener('change', () => { const n = matSel.value; if (n) reflectUIFor(n); });

    opacity.addEventListener('input', async () => {
      const n = matSel.value; if (!n) return;
      const v = Number(opacity.value); if (isNaN(v)) return;
      await applyOpacityToScene(vb, n, v);
    });

    const persist = debounce(async () => {
      const n = matSel.value; if (!n) return;
      const v = Number(opacity.value); if (isNaN(v)) return;
      try {
        await sb.upsertOne({
          materialKey: n, name: n, opacity: v,
          updatedAt: nowISO(), updatedBy: 'ui',
          sheetGid: (window.__lm_sheet_gid || 0), modelKey: (window.__lm_model_key || 'mat-orch')
        });
        saved.set(n, { materialKey: n, name: n, opacity: v, updatedAt: nowISO() });
        log('persisted to sheet:', n, v);
      } catch (e) { warn('upsertOne failed', e); }
    }, 220);

    opacity.addEventListener('change', persist);
    opacity.addEventListener('pointerup', persist);
    opacity.addEventListener('touchend', persist);

    if (names.length) { matSel.value = names[0]; reflectUIFor(names[0]); }
    log('wired panel');
  }

  let wiring = false, wired = false;
  async function maybeWire() {
    if (wired || wiring) return;
    wiring = false; // will set to true while booting
    wiring = true;
    try { await boot(); wired = true; }
    catch (e) { warn('boot failed (will retry automatically)', e); wired = false; }
    finally { wiring = false; }
  }

  window.addEventListener('lm:scene-ready', maybeWire);
  window.addEventListener('lm:sheet-context', (e) => {
    const ctx = e && e.detail ? e.detail : e;
    window.__lm_sheet_gid = (ctx && ctx.sheetGid) || 0;
    maybeWire();
  });
  document.addEventListener('DOMContentLoaded', () => setTimeout(maybeWire, 600));

  log('loaded VERSION_TAG:', VERSION_TAG);
})();
