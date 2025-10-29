(function () {
  const sel = document.getElementById('pm-material');
  const range = document.getElementById('pm-opacity-range');
  const out = document.getElementById('pm-opacity-val');
  if (!sel) return;

  function updateOut(v) { out && (out.textContent = (Number(v) || 0).toFixed(2)); }

  async function fetchMaterials(viewCtx) {
    try {
      if (viewCtx && typeof viewCtx.listMaterials === 'function') {
        const list = await viewCtx.listMaterials();
        return Array.isArray(list) ? list : [];
      }
      if (window.lmViewer && typeof window.lmViewer.listMaterials === 'function') {
        const list = await window.lmViewer.listMaterials();
        return Array.isArray(list) ? list : [];
      }
      const mats = new Map();
      const scene = (viewCtx && viewCtx.scene) || window.lmScene || window.scene;
      if (scene && typeof scene.traverse === 'function') {
        scene.traverse(obj => {
          const m = obj.material;
          if (!m) return;
          if (Array.isArray(m)) m.forEach(mm => mm && mats.set(mm.uuid, mm));
          else mats.set(m.uuid, m);
        });
      }
      return Array.from(mats.values()).map(m => ({ uuid: m.uuid, name: m.name || m.type || m.uuid, material: m }));
    } catch (e) {
      console.debug('[mat-orch] fetchMaterials failed', e);
      return [];
    }
  }

  function fillSelect(materials) {
    while (sel.options.length > 0) sel.remove(0);
    const opt0 = document.createElement('option');
    opt0.value = '';
    opt0.textContent = '— Select material —';
    sel.appendChild(opt0);
    materials.forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.uuid || m.name || '';
      opt.textContent = (m.name && String(m.name)) || 'material';
      opt.dataset.uuid = m.uuid || '';
      sel.appendChild(opt);
    });
  }

  async function populateWhenReady(viewCtx) {
    const MAX_ATTEMPTS = 10;
    let attempt = 0;
    while (attempt++ < MAX_ATTEMPTS) {
      const mats = await fetchMaterials(viewCtx);
      if (mats.length) {
        fillSelect(mats);
        console.debug('[mat-orch] materials populated', mats.length);
        return;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.debug('[mat-orch] materials still empty after retries (will wait for next model)');
  }

  window.addEventListener('lm:model-ready', (ev) => {
    console.debug('[mat-orch] lm:model-ready');
    populateWhenReady(ev && ev.detail);
  }, { once: true });

  setTimeout(() => {
    if (sel.options.length <= 1) {
      populateWhenReady(window.lmViewer || window);
    }
  }, 500);

  if (range) {
    range.addEventListener('input', (e) => updateOut(e.target.value));
    updateOut(range.value);
  }
})();
