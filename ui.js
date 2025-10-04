import { Viewer } from './viewer.js';
import { getAccessToken, isSignedIn } from './gauth.js';
import { normalizeDriveIdFromInput, fetchDriveFileAsArrayBuffer } from './utils_drive_api.js';
import { listSiblingImages } from './utils_drive_images.js';
import { ensureSpreadsheetForFile, listSheetTitles, readSheet, writeSheet } from './sheets_api.js';
import { setupPins } from './pins.js';

export async function setupUI(app){
  const stage = document.getElementById('stage');
  const viewer = new Viewer(stage);
  app.viewer = viewer;
  app.host = stage;

  // Tabs
  const tabs = document.querySelectorAll('#tabs .tab');
  const panes = { cap: document.getElementById('pane-cap'), mat: document.getElementById('pane-mat'), view: document.getElementById('pane-view') };
  tabs.forEach(t=>t.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.toggle('active', x===t));
    Object.values(panes).forEach(p=>p.classList.remove('active'));
    panes[t.dataset.tab].classList.add('active');
  }));

  // Caption controls
  const input = document.getElementById('fileIdInput');
  const btnGLB = document.getElementById('btnLoadGLB');
  const btnDemo = document.getElementById('btnDemo');
  const grid = document.getElementById('imageGrid');

  btnDemo.addEventListener('click', async (e)=>{
    e.preventDefault();
    input.value = '1b4hJCXTKWqoLdFFwtuRykAMMmq2_-RLi'; // demo id
    btnGLB.click();
  });

  btnGLB.addEventListener('click', async ()=>{
    try{
      const id = normalizeDriveIdFromInput(input.value);
      if (!id) throw new Error('Provide Drive file id or URL');
      const ab = await fetchDriveFileAsArrayBuffer(id);
      await viewer.loadGLBFromArrayBuffer(ab);
      app.state.currentGLBId = id;
      // populate images
      grid.innerHTML = '';
      const files = await listSiblingImages(id);
      files.forEach(f=>{
        const cell = document.createElement('div');
        cell.className='cell';
        const img = new Image();
        img.loading='lazy';
        img.src = f.thumbnailLink || `https://lh3.googleusercontent.com/d/${f.id}=w200-h200-c`;
        cell.appendChild(img);
        grid.appendChild(cell);
      });
      // material list
      const matSelect = document.getElementById('matSelect');
      matSelect.innerHTML = viewer.listMaterialLabels().map(([label,i])=>`<option value="${i}">${label}</option>`).join('');
    }catch(err){
      console.error('[ui] load failed', err);
      alert('Failed to load GLB: ' + err.message);
    }
  });

  // Material UI
  const matSelect = document.getElementById('matSelect');
  const matHue = document.getElementById('matHue');
  const matSat = document.getElementById('matSat');
  const matLight = document.getElementById('matLight');
  const matOpacity = document.getElementById('matOpacity');
  const matUnlit = document.getElementById('btnUnlit');
  const matDouble = document.getElementById('btnDouble');
  const matWhiteKey = document.getElementById('matWhiteKey');

  function targetIndex(){ return Number(matSelect.value||-1); }
  function syncButtons(){ /* no-op visual sync for brevity */ }

  matHue.addEventListener('input', ()=> viewer.setHueSatLight(targetIndex(), Number(matHue.value), Number(matSat.value), Number(matLight.value)));
  matSat.addEventListener('input', ()=> viewer.setHueSatLight(targetIndex(), Number(matHue.value), Number(matSat.value), Number(matLight.value)));
  matLight.addEventListener('input', ()=> viewer.setHueSatLight(targetIndex(), Number(matHue.value), Number(matSat.value), Number(matLight.value)));
  matOpacity.addEventListener('input', ()=> viewer.setOpacity(targetIndex(), Number(matOpacity.value)));
  matUnlit.addEventListener('click', ()=>{
    const on = /off$/.test(matUnlit.textContent);
    viewer.setUnlit(targetIndex(), on);
    matUnlit.textContent = 'Unlit: ' + (on ? 'on':'off');
  });
  matDouble.addEventListener('click', ()=>{
    const on = /off$/.test(matDouble.textContent);
    viewer.setDoubleSide(targetIndex(), on);
    matDouble.textContent = 'DoubleSide: ' + (on ? 'on':'off');
  });
  matWhiteKey.addEventListener('input', ()=> viewer.setWhiteKey(targetIndex(), Number(matWhiteKey.value)));

  // View tab
  const btnBg = document.getElementById('btnBg');
  let dark = true;
  btnBg.addEventListener('click', ()=>{ dark=!dark; viewer.setBackground(dark); });

  // Pins overlay minimal (for now)
  app.pins = setupPins(app);

  // Spinner off once minimally booted
  const bootmsg = document.getElementById('bootmsg');
  if (bootmsg) bootmsg.textContent = '';
}
