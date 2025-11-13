
import './caption.ui.patch.js';
import { CAPTIONS_BRIDGE } from './captions.sheet.bridge.js';

let vb = null;
let listEl, addBtn, titleEl, bodyEl;

function el(id){ return document.getElementById(id); }
function ensureViewerBridge(){
  if (vb) return vb;
  vb = window.__viewer_exports || null;
  return vb;
}
function renderList(items){
  listEl.innerHTML = "";
  items.forEach(item => {
    const li = document.createElement('li');
    li.className = "cap-item";
    li.dataset.id = item.id;
    li.textContent = item.title || "(untitled)";
    li.addEventListener('click', ()=> selectItem(item.id));
    listEl.appendChild(li);
  });
}
function selectItem(id){
  listEl.querySelectorAll('.cap-item').forEach(li => {
    li.classList.toggle('active', li.dataset.id === id);
  });
  const v = ensureViewerBridge();
  if (v && typeof v.setPinSelected === 'function'){
    v.setPinSelected(id);
  }
}
async function onShiftPick(point){
  const id = await CAPTIONS_BRIDGE.appendCaption({
    id: undefined,
    title: (titleEl && titleEl.value) || "",
    body: (bodyEl && bodyEl.value) || "",
    x: point.x, y: point.y, z: point.z,
    color: "", imageFileId: ""
  });
  await CAPTIONS_BRIDGE.listCaptions();
  selectItem(id);
  const v = ensureViewerBridge();
  if (v && typeof v.addPinMarker === 'function'){
    v.addPinMarker({ id, position: point });
  }
}
function wire(){
  listEl = el('captionList');
  addBtn = el('addCaptionBtn');
  titleEl = el('captionTitle');
  bodyEl  = el('captionBody');

  document.addEventListener('cap:list-refreshed', (e)=>{
    renderList(e.detail || []);
  });

  if (addBtn){
    addBtn.addEventListener('click', async ()=>{
      const p = {x:0,y:0,z:0};
      await onShiftPick(p);
    });
  }
  window.addEventListener('lm:viewer-shift-pick', async (e)=>{
    const pt = e.detail && e.detail.point;
    if (pt) await onShiftPick(pt);
  });

  if (titleEl) titleEl.addEventListener('change', async ()=>{
    const active = listEl.querySelector('.cap-item.active');
    if (!active) return;
    await CAPTIONS_BRIDGE.updateCaptionById(active.dataset.id, { title: titleEl.value });
    await CAPTIONS_BRIDGE.listCaptions();
  });
  if (bodyEl) bodyEl.addEventListener('change', async ()=>{
    const active = listEl.querySelector('.cap-item.active');
    if (!active) return;
    await CAPTIONS_BRIDGE.updateCaptionById(active.dataset.id, { body: bodyEl.value });
    await CAPTIONS_BRIDGE.listCaptions();
  });
}
document.addEventListener('DOMContentLoaded', wire);
