// boot.esm.cdn.patch.js
// Non-destructive overrides for color chips + filter + shift-pick stability.
// Loaded AFTER boot.esm.cdn.js

// ---- Palette & helpers ----
window.LM_PALETTE = window.LM_PALETTE || ["#ef9368","#e9df5d","#a8e063","#8bb6ff","#b38bff","#86d2c4","#d58cc1","#9aa1a6"];
window.currentPinColor = window.currentPinColor || LM_PALETTE[0];

function __lm_hexToRgb(hex){
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex||"000000");
  return { r: parseInt(m?.[1]||"00",16), g: parseInt(m?.[2]||"00",16), b: parseInt(m?.[3]||"00",16) };
}
function __lm_nearestPalette(hex){
  const c = __lm_hexToRgb(hex||LM_PALETTE[0]);
  let best=LM_PALETTE[0], score=1e9;
  for(const p of LM_PALETTE){
    const q = __lm_hexToRgb(p);
    const d = (c.r-q.r)**2 + (c.g-q.g)**2 + (c.b-q.b)**2;
    if(d<score){ score=d; best=p; }
  }
  return best;
}

// ---- Filter state (persist local) ----
let lmFilterSet = new Set();
try {
  const saved = JSON.parse(localStorage.getItem('lmFilterColors')||'[]');
  lmFilterSet = new Set(saved.length? saved : LM_PALETTE);
}catch{ lmFilterSet = new Set(LM_PALETTE); }
function saveFilter(){ try{ localStorage.setItem('lmFilterColors', JSON.stringify([...lmFilterSet])); }catch{} }

// ---- UI renderers ----
window.renderColorChips = function renderColorChips(){
  const host = document.getElementById('pin-picker') || document.getElementById('pinColorChips');
  if(!host) return;
  host.innerHTML = '';
  LM_PALETTE.forEach(hex=>{
    const b = document.createElement('button');
    b.className = 'chip chip-color'; b.style.setProperty('--chip', hex); b.title = hex;
    if (__lm_nearestPalette(window.currentPinColor) === hex) b.classList.add('is-active');
    b.addEventListener('click', ()=> window.setPinColor ? setPinColor(hex) : (window.currentPinColor=hex));
    host.appendChild(b);
  });
};

window.renderFilterChips = function renderFilterChips(){
  const host = document.getElementById('pin-filter') || document.getElementById('pinFilterChips');
  if(!host) return;
  // All/None bar (ensure exists just above host)
  if(!host.previousElementSibling || !host.previousElementSibling.classList || !host.previousElementSibling.classList.contains('chip-actions')){
    const bar = document.createElement('div'); bar.className='chip-actions';
    const a = document.createElement('button'); a.id='filterAll'; a.className='chip-action'; a.textContent='All';
    const n = document.createElement('button'); n.id='filterNone'; n.className='chip-action'; n.textContent='None';
    a.addEventListener('click', ()=>{ lmFilterSet = new Set(LM_PALETTE); saveFilter(); applyColorFilter(); renderFilterChips(); });
    n.addEventListener('click', ()=>{ lmFilterSet = new Set(); saveFilter(); applyColorFilter(); renderFilterChips(); });
    host.parentNode.insertBefore(bar, host);
    bar.appendChild(a); bar.appendChild(n);
  }
  host.innerHTML = '';
  LM_PALETTE.forEach(hex=>{
    const b = document.createElement('button');
    b.className='chip chip-filter'; b.style.setProperty('--chip', hex); b.title=`filter ${hex}`;
    const mark=document.createElement('span'); mark.className='mark'; mark.textContent='✓'; b.appendChild(mark);
    if(lmFilterSet.has(hex)) b.classList.add('is-on');
    b.addEventListener('click', ()=>{
      if(lmFilterSet.has(hex)) lmFilterSet.delete(hex); else lmFilterSet.add(hex);
      saveFilter(); applyColorFilter(); renderFilterChips();
    });
    host.appendChild(b);
  });
};

// ---- Behavior ----
window.rowPassesColorFilter = function rowPassesColorFilter(row){
  if(!row) return false;
  if(lmFilterSet.size===0) return true; // none selected => show all
  return lmFilterSet.has(__lm_nearestPalette(row.color||LM_PALETTE[0]));
};

window.applyColorFilter = function applyColorFilter(){
  // list side
  const host = document.getElementById('caption-list');
  if (host){
    host.querySelectorAll('.caption-item').forEach(div=>{
      const id = div.dataset.id; const row = (window.rowCache && rowCache.get) ? rowCache.get(id) : null;
      const ok = rowPassesColorFilter(row||{});
      div.classList.toggle('is-hidden', !ok);
    });
  }
  // 3D side: let viewer handle visibility by event
  try{
    document.dispatchEvent(new CustomEvent('pinFilterChange', { detail: { selected: Array.from(lmFilterSet) } }));
  }catch{}
};

// Override setPinColor to ensure save & UI reflect (fallback if not present)
if (!window.setPinColor) {
  window.setPinColor = function setPinColor(hex){
    window.currentPinColor = hex;
    const host = document.getElementById('pin-picker') || document.getElementById('pinColorChips');
    if(host){
      host.querySelectorAll('.chip-color').forEach(el=>{
        el.classList.toggle('is-active', getComputedStyle(el).getPropertyValue('--chip').trim()===hex);
      });
    }
    if (window.selectedPinId && window.rowCache){
      const row = rowCache.get(selectedPinId) || { id:selectedPinId };
      row.color = hex; rowCache.set(selectedPinId, row);
      try{ window.refreshPinMarkerFromRow && refreshPinMarkerFromRow(selectedPinId); }catch{}
      try{ window.updateCaptionForPin && updateCaptionForPin(selectedPinId, { color: hex }); }catch{}
    }
  };
}

// Shift+click stability wrapper (only if original not present)
if (!window.__lmShiftPatched){
  window.__lmShiftPatched = true;
  document.addEventListener('DOMContentLoaded', ()=>{
    try{
      window.renderColorChips && renderColorChips();
      window.renderFilterChips && renderFilterChips();
      window.applyColorFilter && applyColorFilter();
    }catch(e){ console.warn('[lm patch init]', e); }
  });
}
