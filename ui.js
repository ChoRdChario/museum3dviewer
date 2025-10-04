import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js?v=20251004api2';

function pickIdFromUI(){
  const input = document.getElementById('fileIdInput');
  const raw = (input?.value ?? '').trim();
  if (raw) return raw;
  const params = new URLSearchParams(location.search);
  const qid = (params.get('id') ?? '').trim();
  if (qid) return qid;
  return '';
}

export function setupUI(app){
  const el = {
    fileId: document.getElementById('fileIdInput'),
    btnLoad: document.getElementById('btnLoad'),
    spinner: document.getElementById('spinner'),

    // tabs
    tabs: Array.from(document.querySelectorAll('.tab')),
    panes: {
      cap: document.getElementById('pane-cap'),
      mat: document.getElementById('pane-mat'),
      view: document.getElementById('pane-view'),
    },

    // caption elements
    title: document.getElementById('capTitle'),
    body: document.getElementById('capBody'),
    imgGrid: document.getElementById('imgGrid'),
    btnAddPin: document.getElementById('btnAddPin'),
    btnClearPins: document.getElementById('btnClearPins'),

    // material
    matSelect: document.getElementById('matSelect'),
    hue: document.getElementById('slHue'),
    sat: document.getElementById('slSat'),
    light: document.getElementById('slLight'),
    opac: document.getElementById('slOpacity'),
    unlit: document.getElementById('btnUnlit'),
    dbl: document.getElementById('btnDouble'),

    // view
    btnProj: document.getElementById('btnProj'),
  };

  // tabs
  const activate = (key)=>{
    el.tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===key));
    Object.entries(el.panes).forEach(([k,p])=> p.classList.toggle('active', k===key));
  };
  el.tabs.forEach(t=> t.addEventListener('click', ()=> activate(t.dataset.tab)));
  activate('cap');

  // Load GLB
  el.btnLoad.addEventListener('click', async ()=>{
    const raw = pickIdFromUI();
    if (!raw){ el.spinner.textContent='file id/url is empty'; return; }
    try{
      el.spinner.textContent='loading GLB…';
      const id = normalizeDriveIdFromInput(raw);
      app.state.currentGLBId = id;
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLBFromArrayBuffer(buf);
      el.spinner.textContent=''; el.spinner.remove();
    }catch(err){
      console.error('[ui] failed to load', err);
      el.spinner.textContent = 'failed: ' + (err?.message || 'see console');
    }
  });

  // material target + sliders
  const getSelIndex = ()=> { const i = parseInt(el.matSelect.value,10); return isNaN(i)||i<0 ? null : i; };
  const applyHSL = ()=> app.viewer.setHSL(+el.hue.value, +el.sat.value, +el.light.value, getSelIndex());
  const applyOpacity = ()=> app.viewer.setOpacity(+el.opac.value/100, getSelIndex());
  el.hue.addEventListener('input', applyHSL);
  el.sat.addEventListener('input', applyHSL);
  el.light.addEventListener('input', applyHSL);
  el.opac.addEventListener('input', applyOpacity);
  el.unlit.addEventListener('click', ()=>{
    app.state.unlit = !app.state.unlit;
    app.viewer.setUnlit(app.state.unlit, getSelIndex());
    el.unlit.textContent = 'Unlit: ' + (app.state.unlit?'on':'off');
  });
  el.dbl.addEventListener('click', ()=>{
    app.state.doubleSide = !app.state.doubleSide;
    app.viewer.setDoubleSide(app.state.doubleSide, getSelIndex());
    el.dbl.textContent = 'DoubleSide: ' + (app.state.doubleSide?'on':'off');
  });
  window.addEventListener('lmy:model-loaded', (e)=>{
    const mats = e.detail?.materials || [];
    el.matSelect.innerHTML = '<option value="-1">(All)</option>' + mats.map(m=>`<option value="${m.index}">${m.index}: ${m.name}</option>`).join('');
  });

  // view controls
  document.querySelectorAll('.btn.vp').forEach(b=> b.addEventListener('click', ()=> app.viewer.setViewPreset(b.dataset.vp)));
  document.querySelectorAll('.btn.bg').forEach(b=> b.addEventListener('click', ()=> app.viewer.setBackground(b.dataset.bg)));
  el.btnProj.addEventListener('click', ()=>{
    const next = el.btnProj.textContent.includes('persp') ? 'ortho' : 'persp';
    app.viewer.setProjection(next);
    el.btnProj.textContent = 'Projection: ' + next;
  });

  // Images (placeholder)
  const imgs = [1,2,3].map(i => ({id:'dummy'+i, name:'image_'+i+'.jpg', thumb:`https://picsum.photos/seed/${i}/256`}));
  el.imgGrid.innerHTML = imgs.map(x=>`<div class="card"><img src="${x.thumb}" alt="${x.name}"></div>`).join('');
}
