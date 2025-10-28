// material.orchestrator.js
/* eslint-disable */
(() => {
  const LOG = false;
  const log = (...a)=> { if (LOG) console.debug('[mat-orch]', ...a); };

  const state = {
    inited: false,
    mapLabelToTargets: new Map(), // label => [ 'uuid:<uuid>' | 'key:<key>' ]
    active: null,   // { label, targets }
    ui: null,
    rafId: 0,
    pendingSave: 0,
  };

  const readOpacityFromUI = (inputEl) => {
    const v = Number.parseFloat(inputEl?.value);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  };

  function getSceneRoot(){ return window.viewer?.getSceneRoot?.() || window.__LM_SCENE || window.scene || null; }
  function getModelRoot(){
    const via = window.viewer?.getModelRoot?.();
    if (via) return via;
    const r = getSceneRoot(); if (!r) return null;
    let best=null, cnt=-1;
    for (const c of r.children||[]) {
      if (c?.userData?.gltfAsset) return c;
      let k=0; c.traverse(o=>{ if (o.isMesh||o.type==='Mesh') k++; });
      if (k>cnt){ cnt=k; best=c; }
    }
    return best || r;
  }
  function traverseUnderModelRoot(fn){
    const root = getModelRoot();
    if (!root || !root.traverse) return 0;
    let n=0;
    root.traverse((obj)=>{
      const m = obj && obj.material; if (!m) return;
      if (!(obj.isMesh || obj.type==='Mesh')) return;
      if (Array.isArray(m)) m.forEach((mm,i)=>{ n++; fn(obj,mm,i); });
      else { n++; fn(obj,m,0); }
    });
    return n;
  }

  function enumerate(){
    const map = new Map();
    const vlist = (window.viewer?.listMaterials?.() || []).filter(Boolean);
    if (vlist.length>0) {
      const under = new Set(); traverseUnderModelRoot((o,m)=>under.add(m.uuid));
      for (const it of vlist) {
        const name = it?.name || ''; const key = it?.materialKey || ''; const uuid = it?.uuid || '';
        if (uuid && !under.has(uuid)) continue;
        const label = name || (key ? `materialKey:${String(key).slice(-6)}` : (uuid ? `material:${uuid.slice(0,8)}` : 'material'));
        if (!map.has(label)) map.set(label, []);
        if (key) map.get(label).push(`key:${String(key)}`);
        else if (uuid) map.get(label).push(`uuid:${uuid}`);
      }
    }
    if (map.size===0) {
      const byUuid = new Map();
      traverseUnderModelRoot((obj,mat)=>{
        const uuid = mat.uuid; const mname = mat.name || mat.userData?.name || '';
        const oname = obj.name || obj.userData?.name || '';
        const label = mname || (oname ? `[${oname}] · ${uuid.slice(0,8)}` : `material:${uuid.slice(0,8)}`);
        if (!byUuid.has(label)) byUuid.set(label, []);
        byUuid.get(label).push(`uuid:${uuid}`);
      });
      return byUuid;
    }
    return map;
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
  function ensureUI(){
    let sel = document.getElementById('pm-material') || document.querySelector('#pm-material');
    let rng = document.getElementById('pm-opacity-range') || document.querySelector('#pm-opacity-range');
    let val = document.getElementById('pm-opacity-val') || document.querySelector('#pm-opacity-val');
    let rootTab = (sel && (sel.closest('.lm-tabpanel,[role="tabpanel"]') || document.getElementById('tab-material')))
               || document.querySelector('.lm-tabpanel#tab-material, [role="tabpanel"]#tab-material')
               || document.querySelector('.lm-tabpanel[data-panel="material"]')
               || document.querySelector('[role="tabpanel"][aria-labelledby="tabbtn-material"]');
    if (!sel || !rng) {
      if (!rootTab) return null;
      let mount = rootTab.querySelector('#mat-root');
      if (!mount) { mount = document.createElement('div'); mount.id='mat-root'; mount.style.display='flex'; mount.style.flexDirection='column'; mount.style.gap='.5rem'; rootTab.appendChild(mount); }
      mount.innerHTML = `
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-material">Material</label>
          <select id="pm-material" aria-label="material name" style="min-width:12rem"></select>
          <button id="pm-refresh" type="button" title="Refresh materials">↻</button>
        </div>
        <div class="mat-row" style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <label for="pm-opacity-range">Opacity</label>
          <input id="pm-opacity-range" type="range" min="0" max="1" step="0.01" value="1"/>
          <span id="pm-opacity-val" aria-live="polite">1.00</span>
        </div>`;
      sel = mount.querySelector('#pm-material'); rng = mount.querySelector('#pm-opacity-range'); val = mount.querySelector('#pm-opacity-val');
    } else {
      if (!sel.parentElement.querySelector('#pm-refresh')) {
        const btn = document.createElement('button'); btn.id='pm-refresh'; btn.type='button'; btn.title='Refresh materials'; btn.textContent='↻'; sel.insertAdjacentElement('afterend', btn);
      }
    }
    const refresh = (rootTab || document).querySelector('#pm-refresh');
    return (state.ui = {rootTab: rootTab||document.body, sel, rng, val, refresh});
  }
  function fillSelect(){
    const names = [...state.mapLabelToTargets.keys()].sort((a,b)=>a.localeCompare(b));
    const sel = state.ui.sel;
    if (!names.length){ sel.innerHTML = `<option value="">— Select material —</option>`; state.active=null; return; }
    const prev = state.active?.label;
    sel.innerHTML = names.map(n=>`<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('');
    const chosen = (prev && names.includes(prev)) ? prev : names[0];
    sel.value = chosen;
    state.active = { label: chosen, targets: state.mapLabelToTargets.get(chosen)||[] };
  }

  function applyOpacity(opacity){
    if (!state.active) return;
    const transparent = (opacity < 1);
    const depthWrite = (opacity >= 1);
    const apply = window.viewer?.applyMaterialProps;
    for (const t of state.active.targets) {
      if (t.startsWith('key:') && typeof apply === 'function') {
        apply(t.slice(4), { opacity, transparent, depthWrite });
      } else if (t.startsWith('uuid:')) {
        const want = t.slice(5);
        traverseUnderModelRoot((obj, mat)=>{
          if (mat.uuid !== want) return;
          mat.transparent = transparent;
          mat.depthWrite = depthWrite;
          mat.opacity = opacity;
          mat.needsUpdate = true;
        });
      }
    }
  }

  async function saveOpacity(opacity){
    try {
      if (!window.lmMaterials?.upsertMaterial) return;
      const matUuid = (state.active?.targets.find(t=>t.startsWith('uuid:'))||'').slice(5) || null;
      const matName = state.active?.label || '';
      const base = window.lmMaterials.getCachedProps(matUuid) || {};
      const props = Object.assign({}, base, { opacity });
      await window.lmMaterials.upsertMaterial({ matUuid, matName, props });
    } catch(e){ console.warn('[mat-orch] save failed', e); }
  }

  function refreshList(){
    state.mapLabelToTargets = enumerate();
    fillSelect();
  }
  function wireHandlers(){
    const {sel, rng, val, refresh} = state.ui;
    sel.addEventListener('change', ()=>{
      const lbl = sel.value; state.active = { label: lbl, targets: state.mapLabelToTargets.get(lbl)||[] };
      const v = readOpacityFromUI(rng); applyOpacity(v);
    });
    rng.addEventListener('input', ()=>{
      const v = readOpacityFromUI(rng); if (val) val.textContent = v.toFixed(2); applyOpacity(v);
    });
    const commit = ()=>{
      const v = readOpacityFromUI(rng);
      clearTimeout(state.pendingSave);
      state.pendingSave = setTimeout(()=>{ saveOpacity(v); }, 10);
    };
    rng.addEventListener('change', commit);
    rng.addEventListener('pointerup', commit);
    rng.addEventListener('keyup', (e)=>{ if (e.key==='Enter' || e.key===' ') commit(); });

    refresh?.addEventListener('click', ()=>{ refreshList(); const v = readOpacityFromUI(rng); applyOpacity(v); });
    const tabBtn = document.getElementById('tabbtn-material') || document.querySelector('[role="tab"][aria-controls="tab-material"]');
    tabBtn?.addEventListener('click', ()=> setTimeout(()=>{ refreshList(); }, 0));
  }

  function initOnce(){
    if (state.inited) return; state.inited = true;
    const ui = ensureUI(); if (!ui) return;
    refreshList();
    wireHandlers();
    const v = readOpacityFromUI(ui.rng); if (ui.val) ui.val.textContent = v.toFixed(2); applyOpacity(v);
  }

  if (document.readyState !== 'loading') setTimeout(initOnce, 0);
  window.addEventListener('lm:model-ready', initOnce, { once: true });
  window.addEventListener('lm:scene-ready', initOnce, { once: true });
  setTimeout(initOnce, 1500);
})();
