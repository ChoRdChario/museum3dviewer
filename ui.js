import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_stub.js?v=20251004ui';

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

  // material sliders
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

  // perspective/ortho toggle (UI only; actual ortho hookは後段で)
  el.modeChip.addEventListener('click', ()=>{
    if (el.modeChip.textContent==='persp') el.modeChip.textContent='ortho';
    else el.modeChip.textContent='persp';
  });

  // bottom sheet expand on mobile
  el.expandBtn.addEventListener('click', ()=> el.panel.classList.toggle('expanded'));

  // Load GLB
  el.btnLoad.addEventListener('click', async ()=>{
    try{
      el.spinner.textContent = 'loading GLB…';
      const id = normalizeDriveIdFromInput(el.fileId.value);
      app.state.currentGLBId = id;
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLBFromArrayBuffer(buf);
      el.spinner.remove();
    }catch(err){
      console.error('[ui] failed to load', err);
      el.spinner.textContent = 'failed to load GLB. See console.';
    }
  });

  // Image grid (placeholder 3 thumbnails)
  const imgs = [1,2,3].map(i => ({id:'dummy'+i, name:'image_'+i+'.jpg', thumb:`https://picsum.photos/seed/${i}/256`}));
  el.imgGrid.innerHTML = imgs.map(x=>`<div class="card"><img src="${x.thumb}" alt="${x.name}"></div>`).join('');
}
