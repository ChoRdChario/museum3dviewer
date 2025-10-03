
// features/pins.js  (v6.6.4)
import { savePinDebounced, deletePin, readPins } from './sheets.js';
import { toast } from './loading.js';
import { bus } from './state.js';

let pins = new Map();
let spreadsheetId = null;
let fileId = null;
let selectedId = null;

function uid(){ return Math.random().toString(36).slice(2, 10); }

export async function initPins(_fileId, _spreadsheetId){
  fileId = _fileId; spreadsheetId = _spreadsheetId;
  const list = await readPins(spreadsheetId);
  pins = new Map(list.map(p => [p.id, p]));
  renderPinsList();
}

export function getSelectedPin(){ return selectedId? pins.get(selectedId) : null; }
export function getAllPins(){ return Array.from(pins.values()); }

export function addPinAt(x,y,z){
  const p = { id: uid(), x, y, z, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  pins.set(p.id, p);
  renderPinsList();
  savePinDebounced(spreadsheetId, p);
  selectPin(p.id);
  bus.dispatchEvent(new CustomEvent('pin:added', { detail:p }));
}

export function selectPin(id){
  if (!pins.has(id)) return;
  selectedId = id;
  highlightSelectionInList();
  bus.dispatchEvent(new CustomEvent('pin:selected', { detail:{ id } }));
}

export async function removeSelected(){
  if (!selectedId) return;
  const id = selectedId;
  pins.delete(id);
  selectedId = null;
  renderPinsList();
  await deletePin(spreadsheetId, id);
  toast.info('ピンを削除しました');
  bus.dispatchEvent(new CustomEvent('pin:removed', { detail:{ id } }));
}

// ---- rudimentary UI in the side panel (temporary for PR2 smoke) ----
function renderPinsList(){
  const host = document.getElementById('pins-box') || createPinsBox();
  host.innerHTML = '';
  for(const p of pins.values()){
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid rgba(255,255,255,.06);border-radius:10px;margin-bottom:6px;';
    const btn = document.createElement('button');
    btn.textContent = '●';
    btn.style.cssText = 'width:24px;height:24px;border-radius:50%';
    btn.onclick = ()=> selectPin(p.id);
    const label = document.createElement('div');
    label.textContent = `${p.id}  (x:${p.x.toFixed(2)}, y:${p.y.toFixed(2)}, z:${p.z.toFixed(2)})`;
    label.style.cssText = 'font-size:12px;color:#9aa4b2';
    row.appendChild(btn); row.appendChild(label);
    host.appendChild(row);
  }
  highlightSelectionInList();
}

function highlightSelectionInList(){
  const host = document.getElementById('pins-box');
  if (!host) return;
  Array.from(host.children).forEach((row, i)=>{
    const id = Array.from(pins.values())[i]?.id;
    row.style.outline = (id===selectedId) ? '2px solid #6ea8fe' : 'none';
  });
}

function createPinsBox(){
  const side = document.getElementById('side');
  const box = document.createElement('div');
  box.id = 'pins-box';
  const header = document.createElement('div');
  header.textContent = 'Pins';
  header.style.cssText = 'font-weight:700;margin:8px 0';
  side.appendChild(header);
  side.appendChild(box);
  return box;
}
