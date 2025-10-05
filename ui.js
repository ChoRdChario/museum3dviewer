import { ensureDriveApi } from './utils_drive_api.js';

export function setupUI(app){
  const v = app.viewer;
  const auth = app.auth;
  const drive = ensureDriveApi(()=>auth.getAccessToken && auth.getAccessToken());

  // --- Tabs ---
  const tabs = Array.from(document.querySelectorAll('[data-tab]'));
  tabs.forEach(tab => tab.addEventListener('click', ()=>{
    const t = tab.dataset.tab;
    document.querySelectorAll('.pane').forEach(p => p.classList.toggle('hidden', p.id !== `pane-${t}`));
    tabs.forEach(x=>x.classList.toggle('active', x===tab));
  }));

  // --- Material controls ---
  const slHue = document.getElementById('slHue');
  const slSat = document.getElementById('slSat');
  const slLight = document.getElementById('slLight');
  const slOpacity = document.getElementById('slOpacity');
  const cbUnlit = document.getElementById('cbUnlit');
  const cbDouble = document.getElementById('cbDouble');

  function applyMaterial(){
    v.setHue(+slHue.value/100);
    v.setSat(+slSat.value/100);
    v.setLight(+slLight.value/100);
    v.setOpacity(+slOpacity.value/100);
    v.setUnlit(cbUnlit.checked);
    v.setDoubleSide(cbDouble.checked);
  }
  [slHue,slSat,slLight,slOpacity,cbUnlit,cbDouble].forEach(el => el && el.addEventListener('input', applyMaterial));
  applyMaterial();

  // --- GLB loading ---
  const tbGLB = document.getElementById('tbGLB');
  const btnLoad = document.getElementById('btnLoadGLB');
  const aDemo = document.getElementById('lnkDemo');

  function parseDriveId(input){
    if(!input) return '';
    // matches id= or /d/{id}/ style
    const m = input.match(/(?:id=|\/d\/)([\w-]{20,})/);
    return m ? m[1] : input.trim();
  }

  async function loadFromDrive(){
    const id = parseDriveId(tbGLB.value);
    if(!id){ alert('Enter Drive file ID or URL'); return; }
    const buf = await drive.fetchFileAsArrayBuffer(id);
    await v.loadGLBFromArrayBuffer(buf);
  }
  btnLoad?.addEventListener('click', e=>{ e.preventDefault(); loadFromDrive().catch(err=>{ console.error('[ui] GLB load failed', err); alert('Failed to load GLB. See console.'); }); });

  // local demo (CDN-hosted sample)
  aDemo?.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      const resp = await fetch('https://unpkg.com/@loaders.gl/gltf@4.2.0/dist/test/data/Duck.glb');
      const buf = await resp.arrayBuffer();
      await v.loadGLBFromArrayBuffer(buf);
    }catch(err){ console.error('[ui] demo failed', err); alert('Demo load failed.'); }
  });
}
