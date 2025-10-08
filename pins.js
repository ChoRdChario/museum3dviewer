import { ensureViewer, loadGLBFromDrive, addPinAtCenter, setPinColor, getAllPins } from './viewer.js';
import { ensureSpreadsheetForFile, ensurePinsHeader, listSheetTitles, loadPins, savePins } from './sheets_api.js?v=stub';
import { downloadImageAsBlob } from './utils_drive_images.js?v=stub';

function $(id){ return document.getElementById(id); }
function log(...args){ console.log('[pins]', ...args); }

// --- UI elements ---
const fileIdInput = $('fileIdInput');
const btnLoad = $('btnLoad');
const btnAddPin = $('btnAddPin');
const btnRefreshImages = $('btnRefreshImages');
const capList = $('capList');
const capTitle = $('capTitle');
const capBody = $('capBody');
const authChip = $('authChip');
const sheetSelect = $('sheetSelect');
const tabs = $('tabs');

// Pane containers
const paneCap = $('pane-cap');
const paneMat = $('pane-mat');
const paneView = $('pane-view');

// --- Boot ---
(async function boot(){
  log('ready');
  await ensureViewer();
  wireTabs();
  wireAuth();
  wireGLB();
  wirePins();
  await initSheets('demo');
})();

function wireTabs(){
  tabs.addEventListener('click', (e)=>{
    const t = e.target.closest('button');
    if(!t) return;
    const name = t.dataset.tab;
    for(const el of [paneCap, paneMat, paneView]) el.style.display = 'none';
    (name==='cap'?paneCap:name==='mat'?paneMat:paneView).style.display = 'block';
    // active ui
    for(const b of tabs.querySelectorAll('button')) b.classList.toggle('active', b===t);
  });
}

function wireAuth(){
  authChip.addEventListener('click', ()=>{
    log('[auth] sign-in clicked (stub)');
    alert('Sign-in is stubbed in this offline build.');
  });
}

function wireGLB(){
  btnLoad.addEventListener('click', async ()=>{
    const idOrUrl = fileIdInput.value.trim();
    const resolved = idOrUrl || 'demo';
    log('[GLB] requested load', resolved);
    try{
      await ensureViewer();
      await loadGLBFromDrive(resolved);
    }catch(err){
      console.error('[GLB] load failed', err);
      alert('Failed to load GLB: ' + err.message);
    }
  });
}

function renderCapList(rows){
  capList.value = (rows||[]).map(r => `• (${r.color||'-'}) ${r.title||''} — ${r.body||''}`).join('\n');
}

function wirePins(){
  btnAddPin.addEventListener('click', async ()=>{
    const color = '#ffd54f'; // default amber
    setPinColor(color);
    const pin = await addPinAtCenter({ title: capTitle.value, body: capBody.value, color });
    const all = getAllPins();
    renderCapList(all);
    await persistPins();
  });
  btnRefreshImages.addEventListener('click', async ()=>{
    const blob = await downloadImageAsBlob('demo');
    log('[images] fetched blob', blob.size, 'bytes');
    alert('Images refreshed (stub).');
  });
}

async function initSheets(fileId){
  const sheetId = await ensureSpreadsheetForFile(fileId);
  await ensurePinsHeader(sheetId);
  const sheets = await listSheetTitles(sheetId);
  sheetSelect.innerHTML = '';
  for(const s of sheets){
    const opt = document.createElement('option');
    opt.value = opt.textContent = s;
    sheetSelect.appendChild(opt);
  }
  const rows = await loadPins(sheetId, sheets[0]);
  renderCapList(rows);
}

async function persistPins(){
  const fileId = 'demo';
  const sheet = sheetSelect.value || 'Pins';
  const rows = getAllPins();
  await savePins(fileId, sheet, rows);
}
