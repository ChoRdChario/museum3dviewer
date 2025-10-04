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
    hue: document.getElementById('slHue'),
    sat: document.getElementById('slSat'),
    light: document.getElementById('slLight'),
    opac: document.getElementById('slOpacity'),
    unlit: document.getElementById('btnUnlit'),
    dbl: document.getElementById('btnDouble'),
    whiteKey: document.getElementById('slWhiteKey'),
    fileId: document.getElementById('fileIdInput'),
    btnLoad: document.getElementById('btnLoad'),
    modeChip: document.getElementById('modeChip'),
    expandBtn: document.getElementById('expandBtn'),
    panel: document.getElementById('panel'),
    overlay: document.getElementById('overlay'),
    imgGrid: document.getElementById('imgGrid'),
    spinner: document.getElementById('spinner')
  };

  const applyHSL = ()=> app.viewer.setHSL(+el.hue.value, +el.sat.value, +el.light.value);
  const applyOpacity = ()=> app.viewer.setOpacity(+el.opac.value/100);
  el.hue.addEventListener('input', applyHSL);
  el.sat.addEventListener('input', applyHSL);
  el.light.addEventListener('input', applyHSL);
  el.opac.addEventListener('input', applyOpacity);
  el.unlit.addEventListener('click', ()=>{
    app.state.unlit = !app.state.unlit;
    app.viewer.setUnlit(app.state.unlit);
    el.unlit.textContent = 'Unlit: ' + (app.state.unlit?'on':'off');
  });
  el.dbl.addEventListener('click', ()=>{
    app.state.doubleSide = !app.state.doubleSide;
    app.viewer.setDoubleSide(app.state.doubleSide);
    el.dbl.textContent = 'DoubleSide: ' + (app.state.doubleSide?'on':'off');
  });

  el.modeChip.addEventListener('click', ()=>{
    if (el.modeChip.textContent==='persp') el.modeChip.textContent='ortho';
    else el.modeChip.textContent='persp';
  });

  el.expandBtn.addEventListener('click', ()=> el.panel.classList.toggle('expanded'));

  el.btnLoad.addEventListener('click', async ()=>{
    const raw = pickIdFromUI();
    if (!raw){
      el.spinner.textContent = 'file id/url is empty. Enter Drive ID, share URL, or "demo".';
      console.warn('[ui] empty id/url');
      return;
    }
    try{
      el.spinner.textContent = 'loading GLB…';
      const id = normalizeDriveIdFromInput(raw);
      app.state.currentGLBId = id;
      console.log('[ui] fetching GLB id=', id);
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLBFromArrayBuffer(buf);
      el.spinner.textContent = '';
      el.spinner.remove();
    }catch(err){
      console.error('[ui] failed to load', err);
      el.spinner.textContent = 'failed to load GLB. ' + (err && err.message ? err.message : 'See console.');
    }
  });

  const imgs = [1,2,3].map(i => ({id:'dummy'+i, name:'image_'+i+'.jpg', thumb:`https://picsum.photos/seed/${i}/256`}));
  el.imgGrid.innerHTML = imgs.map(x=>`<div class="card"><img src="${x.thumb}" alt="${x.name}"></div>`).join('');
}
