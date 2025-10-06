
import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js?v=20251005';

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
    overlay: document.getElementById('overlay'),
    imgGrid: document.getElementById('imgGrid'),
    spinner: document.getElementById('spinner'),
    whiteEnable: document.getElementById('chkWhiteEnable') || null,
  };

  const applyHSL = ()=> app.viewer?.setHSL(+el.hue.value, +el.sat.value, +el.light.value);
  const applyOpacity = ()=> app.viewer?.setOpacity(+el.opac.value/100);
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

  // White-key controls (enable + threshold slider)
  if (el.whiteEnable) {
    el.whiteEnable.addEventListener('change', ()=>{
      app.viewer.setWhiteKeyEnabled(el.whiteEnable.checked);
    });
  }
  if (el.whiteKey) {
    el.whiteKey.addEventListener('input', ()=>{
      app.viewer.setWhiteKeyThreshold(+el.whiteKey.value/100);
    });
  }

  el.modeChip.addEventListener('click', ()=>{
    el.modeChip.textContent = (el.modeChip.textContent==='persp') ? 'ortho' : 'persp';
  });

  // Load button
  el.btnLoad.addEventListener('click', async ()=>{
    try{
      el.spinner.textContent = 'Loading GLB…';
      const id = normalizeDriveIdFromInput(el.fileId.value);
      app.state.currentGLBId = id;
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLBFromArrayBuffer(buf);
      el.spinner.remove();
    }catch(err){
      console.error('[ui] failed to load', err);
      el.spinner.textContent = 'failed to load GLB. ' + (err && err.message ? err.message : 'See console.');
    }
  });

  // Demo thumbnails (placeholder)
  const imgs = [1,2,3].map(i => ({id:'dummy'+i, name:'image_'+i+'.jpg', thumb:`https://picsum.photos/seed/${i}/256`}));
  el.imgGrid.innerHTML = imgs.map(x=>`<div class="card"><img src="${x.thumb}" alt="${x.name}"></div>`).join('');
}
