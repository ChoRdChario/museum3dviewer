// ui.js - v6.6 patched
import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js';

export function setupUI(app){
  const $ = (id)=>document.getElementById(id);
  const el = {
    fileId: $('fileIdInput'),
    btnLoad: $('btnLoad'),
    slHue: $('slHue'), slSat: $('slSat'), slLight: $('slLight'),
    slOpacity: $('slOpacity'),
    btnUnlit: $('btnUnlit'),
    btnDouble: $('btnDouble'),
    slWhiteKey: $('slWhiteKey'),
    chkWhiteKey: $('chkWhiteKey'),
    matSelect: $('matSelect'),
  };

  // material target
  el.matSelect?.addEventListener('change', ()=>{
    app.viewer.setMaterialTarget(parseInt(el.matSelect.value,10));
  });

  function applyHSL(){ app.viewer.setHSL(+el.slHue.value, +el.slSat.value, +el.slLight.value); }
  function applyOpacity(){ app.viewer.setOpacity(+el.slOpacity.value/100); }
  el.slHue?.addEventListener('input', applyHSL);
  el.slSat?.addEventListener('input', applyHSL);
  el.slLight?.addEventListener('input', applyHSL);
  el.slOpacity?.addEventListener('input', applyOpacity);

  el.btnUnlit?.addEventListener('click', ()=>{
    const on = el.btnUnlit.dataset.on === '1' ? 0 : 1;
    el.btnUnlit.dataset.on = String(on);
    el.btnUnlit.textContent = 'Unlit: ' + (on?'on':'off');
    app.viewer.setUnlit(!!on);
  });
  el.btnDouble?.addEventListener('click', ()=>{
    const on = el.btnDouble.dataset.on === '1' ? 0 : 1;
    el.btnDouble.dataset.on = String(on);
    el.btnDouble.textContent = 'DoubleSide: ' + (on?'on':'off');
    app.viewer.setDoubleSide(!!on);
  });

  el.chkWhiteKey?.addEventListener('change', ()=>{
    app.viewer.setWhiteKeyEnabled(el.chkWhiteKey.checked);
  });
  el.slWhiteKey?.addEventListener('input', ()=>{
    app.viewer.setWhiteKeyThreshold(+el.slWhiteKey.value/100);
  });

  el.btnLoad?.addEventListener('click', async ()=>{
    try{
      const id = normalizeDriveIdFromInput(el.fileId.value);
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLB(buf);
    }catch(err){
      console.error('[ui] failed to load', err);
      alert('Failed to load GLB: '+(err?.message||err));
    }
  });
}
