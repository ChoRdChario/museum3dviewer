import { Auth } from './auth.js';
import { Drive } from './drive.js';
import { Sheets } from './sheets.js';
import { Viewer } from './viewer.js';
import { setupTabs, setLoading, toast } from './ui.js';

const CONFIG = window.__LOCIMYU_CONFIG__;
const auth = new Auth(CONFIG);
const drive = new Drive();
const sheets = new Sheets();
let viewer;
let spreadsheetId = null;
let currentSlot = 'Default';
let currentModelMeta = null;
let addPinMode = false;

function $(id){ return document.getElementById(id); }

async function init(){
  setupTabs();
  viewer = new Viewer($('viewer'));
  viewer.animate();
  $('manualLink').href = CONFIG.manualPdfPath;

  $('signinBtn').onclick = ()=> auth.ensureAuth(onAuthed);
  $('signoutBtn').onclick = ()=> { auth.signOut(); updateAuthUi(); };
  await auth.init();
  auth.createTokenClient(onAuthed);
  updateAuthUi();

  $('loadModelBtn').onclick = onLoadModel;
  $('addPinBtn').onclick = ()=>{
    addPinMode = !addPinMode;
    $('addPinBtn').classList.toggle('primary', addPinMode);
  };
  $('pinFilter').onchange = refreshPinFilter;

  // Materials
  $('matOpacity').oninput = (e)=>{
    $('matOpacityVal').textContent = (+e.target.value).toFixed(2);
    viewer.setMaterialConfig({ opacity: +e.target.value });
    scheduleAutoSaveMaterials();
  };
  $('matDoubleSided').onchange = e=>{ viewer.setMaterialConfig({ doubleSided: e.target.checked }); scheduleAutoSaveMaterials(); };
  $('matUnlit').onchange = e=>{ viewer.setMaterialConfig({ unlit: e.target.checked }); scheduleAutoSaveMaterials(); };
  $('matWhiteKey').onchange = e=>{ viewer.setMaterialConfig({ whiteKey: e.target.checked }); scheduleAutoSaveMaterials(); };
  $('matWhiteKeyThr').oninput = e=>{ viewer.setMaterialConfig({ whiteThr: +e.target.value }); scheduleAutoSaveMaterials(); };
  $('matBlackKey').onchange = e=>{ viewer.setMaterialConfig({ blackKey: e.target.checked }); scheduleAutoSaveMaterials(); };
  $('matBlackKeyThr').oninput = e=>{ viewer.setMaterialConfig({ blackThr: +e.target.value }); scheduleAutoSaveMaterials(); };

  // Camera
  document.querySelectorAll('.camPreset').forEach(b=> b.onclick = ()=> viewer.setCameraPreset(b.dataset.v));
  $('orthoToggle').onchange = e=> viewer.toggleOrtho(e.target.checked);
  $('bgColor').onchange = e=> viewer.setBgColor(e.target.value);

  // Captions UI bind
  $('capSaveBtn').onclick = onSaveCaption;
  $('capDeleteBtn').onclick = onDeleteCaption;

  $('capImageLocal').addEventListener('change', onLocalImagePicked);

  // Save slot ops
  $('newSaveBtn').onclick = ()=> renameOrCreateSlot(true);
  $('dupSaveBtn').onclick = duplicateSlot;
  $('renameSaveBtn').onclick = ()=> renameOrCreateSlot(false);

  // Viewer click to add pin
  $('viewer').addEventListener('click', onViewerClick);

  // readonly link
  $('readonlyLinkBtn').onclick = ()=>{
    const u = new URL(location.href);
    u.searchParams.set(CONFIG.readOnlyParam, '1');
    navigator.clipboard.writeText(u.toString());
    toast('閲覧専用リンクをコピーしました');
  };

  // If readonly mode, disable editing controls
  if(new URL(location.href).searchParams.get(CONFIG.readOnlyParam)==='1'){
    document.body.classList.add('readonly');
  }
}

function updateAuthUi(){
  $('signinBtn').disabled = auth.isAuthed;
  $('signoutBtn').disabled = !auth.isAuthed;
}

async function onAuthed(){
  updateAuthUi();
  toast('サインイン完了');
}

function getInputModel(){
  return $('modelUrl').value.trim();
}

async function onLoadModel(){
  try{
    setLoading(true);
    // Resolve fileId and meta
    const input = getInputModel();
    const fileId = await drive.getFileId(input);
    const meta = await drive.getFileMeta(fileId);
    currentModelMeta = meta;
    const buf = await drive.downloadFile(fileId);
    await viewer.loadGLB(buf);
    // Spreadsheet in same folder
    const spreadsheet = await drive.findOrCreateSpreadsheetInSameFolder(meta, CONFIG.spreadsheetTitleSuffix);
    spreadsheetId = spreadsheet.id;
    // populate slots
    await ensureDefaultSlots();
    await populateSlots();
    await loadSlot(currentSlot);
    // list images
    const folderId = (meta.parents && meta.parents[0]) || null;
    await populateImageSelect(folderId);
  }catch(err){
    console.error(err);
    alert('モデルの読み込みに失敗: ' + err.message);
  }finally{
    setLoading(false);
  }
}

async function ensureDefaultSlots(){
  await sheets.ensureSaveSheets(spreadsheetId, currentSlot);
}

async function populateSlots(){
  const slots = await sheets.listSlots(spreadsheetId);
  const el = $('saveSlot'); el.innerHTML = '';
  for(const s of slots){
    const opt = document.createElement('option');
    opt.value = s; opt.textContent = s;
    el.appendChild(opt);
  }
  if(!slots.includes(currentSlot) && slots.length>0) currentSlot = slots[0];
  el.value = currentSlot;
  el.onchange = async ()=>{
    currentSlot = el.value;
    await loadSlot(currentSlot);
  };
}

async function loadSlot(slot){
  await sheets.ensureSaveSheets(spreadsheetId, slot);
  // Load pins
  const pins = await sheets.readPins(spreadsheetId, slot);
  // Clear existing pins
  Array.from(viewer.pins.keys()).forEach(id=> viewer.removePin(id));
  for(const p of pins){
    const id = viewer.addPinAt(new THREE.Vector3(p.x,p.y,p.z), p.color, p.id);
    viewer.updatePinVisual(id, { title:p.title, body:p.body, imageId:p.imageId, imageName:p.imageName });
  }
  refreshCaptionList();
  // Materials
  const mat = await sheets.readMaterials(spreadsheetId, slot);
  // Apply defaults if empty
  viewer.setMaterialConfig({
    opacity: mat.opacity ? +mat.opacity : 1,
    doubleSided: mat.doubleSided === 'true',
    unlit: mat.unlit === 'true',
    whiteKey: mat.whiteKey === 'true',
    whiteThr: mat.whiteThr? +mat.whiteThr : .95,
    blackKey: mat.blackKey === 'true',
    blackThr: mat.blackThr? +mat.blackThr : .05,
  });
  $('matOpacity').value = viewer.currentMaterialCfg.opacity;
  $('matOpacityVal').textContent = (+$('matOpacity').value).toFixed(2);
  $('matDoubleSided').checked = viewer.currentMaterialCfg.doubleSided;
  $('matUnlit').checked = viewer.currentMaterialCfg.unlit;
  $('matWhiteKey').checked = viewer.currentMaterialCfg.whiteKey;
  $('matWhiteKeyThr').value = viewer.currentMaterialCfg.whiteThr;
  $('matBlackKey').checked = viewer.currentMaterialCfg.blackKey;
  $('matBlackKeyThr').value = viewer.currentMaterialCfg.blackThr;
}

async function populateImageSelect(folderId){
  const sel = $('capImageSelect'); sel.innerHTML = '<option value="">(なし)</option>';
  if(!folderId) return;
  const imgs = await drive.listImagesInFolder(folderId);
  for(const f of imgs){
    const opt = document.createElement('option');
    opt.value = f.id;
    const low = (f.name||'').toLowerCase();
    const isHeic = low.endsWith('.heic') || low.endsWith('.heif') || (f.mimeType||'').toLowerCase()==='image/heic' || (f.mimeType||'').toLowerCase()==='image/heif';
    opt.textContent = isHeic ? `${f.name}（選択時に自動変換）` : f.name;
    sel.appendChild(opt);
  }
}

function refreshPinFilter(){
  const filter = $('pinFilter').value;
  for(const rec of viewer.pins.values()){
    const show = (filter==='all' || rec.color===filter);
    rec.dotMesh.visible = show;
    rec.line.visible = show;
    rec.label.visible = show;
  }
}

function refreshCaptionList(){
  const list = $('captionList'); list.innerHTML = '';
  for(const rec of viewer.pins.values()){
    const div = document.createElement('div');
    div.className = 'caption-item';
    div.dataset.id = rec.id;
    div.textContent = rec.title || '(無題)';
    if(rec.id === selectedId) div.classList.add('active');
    div.onclick = ()=> selectCaption(rec.id);
    list.appendChild(div);
  }
}

let selectedId = null;
function selectCaption(id){
  selectedId = id;
  document.querySelectorAll('.caption-item').forEach(n=> n.classList.toggle('active', n.dataset.id===id));
  const rec = viewer.pins.get(id); if(!rec) return;
  $('capTitle').value = rec.title || '';
  $('capBody').value = rec.body || '';
  $('capColor').value = rec.color || 'red';
  $('capImageSelect').value = rec.imageId || '';
  $('capImageSelect').onchange = onImageSelectChanged;
}

async function onSaveCaption(){
  if(!selectedId) return;
  const rec = viewer.pins.get(selectedId); if(!rec) return;
  viewer.updatePinVisual(selectedId, {
    title: $('capTitle').value.trim(),
    body: $('capBody').value.trim(),
    color: $('capColor').value,
    imageId: $('capImageSelect').value || '',
    imageName: $('capImageSelect').selectedOptions[0]?.textContent || '',
  });
  refreshCaptionList();
  await persistPins();
}

async function onDeleteCaption(){
  if(!selectedId) return;
  viewer.removePin(selectedId);
  selectedId = null;
  refreshCaptionList();
  await persistPins();
}

async function persistPins(){
  if(!spreadsheetId) return;
  const rows = Array.from(viewer.pins.values()).map(rec=>[
    rec.id, rec.xyz.x, rec.xyz.y, rec.xyz.z, rec.color, rec.title, rec.body, rec.imageId, rec.imageName
  ]);
  await sheets.writePins(spreadsheetId, currentSlot, rows);
}

let matSaveTimer = null;
function scheduleAutoSaveMaterials(){
  if(!spreadsheetId) return;
  clearTimeout(matSaveTimer);
  matSaveTimer = setTimeout(async ()=>{
    const cfg = viewer.currentMaterialCfg;
    await sheets.writeMaterials(spreadsheetId, currentSlot, {
      opacity: cfg.opacity, doubleSided: String(cfg.doubleSided), unlit: String(cfg.unlit),
      whiteKey: String(cfg.whiteKey), whiteThr: cfg.whiteThr,
      blackKey: String(cfg.blackKey), blackThr: cfg.blackThr
    });
  }, 800);
}

async function onViewerClick(e){
  if(new URL(location.href).searchParams.get(CONFIG.readOnlyParam)==='1') return; // readonly
  if(!addPinMode) return;
  // compute intersection
  const rect = e.currentTarget.getBoundingClientRect();
  const x = e.clientX - rect.left; const y = e.clientY - rect.top;
  const fakeEvt = { clientX: e.clientX, clientY: e.clientY };
  viewer.onPointerMove(fakeEvt);
  const hit = viewer.pick(true);
  if(hit){
    const p = hit.point;
    const id = viewer.addPinAt(p, 'red');
    selectCaption(id);
    await persistPins();
  }
}

async function renameOrCreateSlot(isCreate){
  const name = prompt(isCreate? '新規セーブ名' : '新しいセーブ名', currentSlot);
  if(!name) return;
  await sheets.ensureSaveSheets(spreadsheetId, name);
  if(isCreate){
    currentSlot = name;
  }else{
    // Copy data from old slot to new name then (optional) delete old sheets?
    const old = currentSlot;
    // Simple rename by copy: read old -> write to new
    const pins = await sheets.readPins(spreadsheetId, old);
    await sheets.writePins(spreadsheetId, name, pins.map(p=>[p.id,p.x,p.y,p.z,p.color,p.title,p.body,p.imageId,p.imageName]));
    const mat = await sheets.readMaterials(spreadsheetId, old);
    await sheets.writeMaterials(spreadsheetId, name, mat);
    currentSlot = name;
  }
  await populateSlots();
  await loadSlot(currentSlot);
}

async function duplicateSlot(){
  const name = prompt('コピー先セーブ名', currentSlot+' Copy');
  if(!name) return;
  await sheets.ensureSaveSheets(spreadsheetId, name);
  const pins = await sheets.readPins(spreadsheetId, currentSlot);
  await sheets.writePins(spreadsheetId, name, pins.map(p=>[p.id,p.x,p.y,p.z,p.color,p.title,p.body,p.imageId,p.imageName]));
  const mat = await sheets.readMaterials(spreadsheetId, currentSlot);
  await sheets.writeMaterials(spreadsheetId, name, mat);
  await populateSlots();
}

window.addEventListener('DOMContentLoaded', init);


async function onLocalImagePicked(e){
  if(!currentModelMeta){ alert('まずモデルを読み込んでください'); e.target.value=''; return; }
  const folderId = (currentModelMeta.parents && currentModelMeta.parents[0]) || null;
  if(!folderId){ alert('アップロード先フォルダを特定できません'); return; }
  const file = e.target.files && e.target.files[0]; if(!file) return;

  // Preview best-effort
  const pv = $('capImagePreview');
  try{
    const url = URL.createObjectURL(file);
    pv.src = url;
    pv.style.display = 'block';
  }catch(_){ pv.style.display='none'; }

  // Upload as-is (HEICもそのままアップロード)
  const saved = await drive.uploadToFolder(folderId, file, file.name, file.type || 'application/octet-stream');
  await populateImageSelect(folderId);
  $('capImageSelect').value = saved.id;
  toast('画像をアップロードしました（HEICは選択時に自動変換）');
}

function isHeicName(name, mime){
  const nm = (name||'').toLowerCase();
  const mt = (mime||'').toLowerCase();
  return nm.endsWith('.heic') || nm.endsWith('.heif') || mt==='image/heic' || mt==='image/heif';
}

async function onImageSelectChanged(){
  const sel = $('capImageSelect');
  const id = sel.value;
  const pv = $('capImagePreview');
  if(!id){ pv.style.display='none'; pv.src=''; return; }

  // Fetch meta to know if it's HEIC
  const meta = await drive.getFileMeta(id);
  if(isHeicName(meta.name, meta.mimeType)){
    // Download HEIC, convert to JPEG, upload back, switch selection
    const buf = await drive.downloadFile(id);
    const heicBlob = new Blob([buf], { type: meta.mimeType || 'image/heic' });
    try{
      const jpegBlob = await window.heic2any({ blob: heicBlob, toType: 'image/jpeg', quality: 0.92 });
      const safeName = meta.name.replace(/\.(heic|heif)$/i, '.jpg');
      const folderId = (meta.parents && meta.parents[0]) || (currentModelMeta?.parents?.[0]) || null;
      if(!folderId){ alert('変換後の保存先フォルダを特定できません'); return; }
      const saved = await drive.uploadToFolder(folderId, jpegBlob, safeName, 'image/jpeg');
      // Refresh list and switch to the new JPEG
      await populateImageSelect(folderId);
      $('capImageSelect').value = saved.id;
      // Preview JPEG
      const url = URL.createObjectURL(jpegBlob);
      pv.src = url; pv.style.display = 'block';
      toast('HEICをJPEGへ変換しました。元のHEICはそのまま残しています。');
    }catch(err){
      console.warn('HEIC変換失敗', err);
      alert('HEICの変換に失敗しました。ネットワークやファイル状態を確認してください。');
      pv.style.display='none';
    }
  }else{
    // Non-HEIC: Download for preview only
    try{
      const buf = await drive.downloadFile(id);
      const blob = new Blob([buf], { type: meta.mimeType || 'image/jpeg' });
      const url = URL.createObjectURL(blob);
      pv.src = url; pv.style.display = 'block';
    }catch(_){
      pv.style.display='none';
    }
  }
}
