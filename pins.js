// pins.js — A+B UI 完了版（旧UI廃止）
import { ensureSpreadsheetForFile, ensurePinsHeader, listSheetTitles, loadPins, savePins } from './sheets_api.js?v=20251004s3';

const PALETTE = [
  { key:'sky',   hex:'#55ccff' },
  { key:'amber', hex:'#ffcc55' },
  { key:'lime',  hex:'#a3e635' },
  { key:'rose',  hex:'#f43f5e' },
  { key:'violet',hex:'#8b5cf6' },
  { key:'slate', hex:'#94a3b8' }
];

export function setupPins(app){
  // DOM
  const overlay = document.getElementById('overlay');
  const titleInput = document.getElementById('capTitle');
  const bodyInput  = document.getElementById('capBody');
  const btnAdd     = document.getElementById('btnAddPin');
  const imgGrid    = document.getElementById('imgGrid');
  const sheetSelect= document.getElementById('sheetSelect');
  const btnNewSheet= document.getElementById('btnNewSheet');
  const capList    = document.getElementById('capList');
  const pinPalette = document.getElementById('pinPalette');
  const filterToggles = document.getElementById('pinFilterToggles');
  if (!overlay || !pinPalette || !filterToggles || !capList) {
    console.error('[pins] required elements missing');
    return;
  }

  // state
  const pins = [];
  let selected = null;
  let spreadsheetId = null;
  let sheetName = 'Pins';
  let currentColor = PALETTE[0].hex;
  const filterVisible = Object.fromEntries(PALETTE.map(c=>[c.hex,true]));

  // svg leader
  const svg = document.getElementById('leader');
  const leaderLine = document.getElementById('leaderLine');
  let halo = document.getElementById('leaderHalo');
  if (!halo){
    halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('id','leaderHalo');
    halo.setAttribute('cx','0'); halo.setAttribute('cy','0'); halo.setAttribute('r','8');
    halo.style.fill='none'; halo.style.stroke=currentColor; halo.style.strokeWidth='2'; halo.style.opacity='0';
    svg.appendChild(halo);
  }

  // palette + toggles
  function setupPalette(){
    pinPalette.innerHTML = '';
    PALETTE.forEach((c,i)=>{
      const sw = document.createElement('button');
      sw.type='button';
      sw.className='sw'+(i===0?' active':'');
      sw.title = c.key;
      sw.style.background = c.hex;
      sw.dataset.hex=c.hex;
      sw.addEventListener('click',()=>{
        pinPalette.querySelectorAll('.sw').forEach(x=>x.classList.remove('active'));
        sw.classList.add('active');
        currentColor = c.hex;
        halo.style.stroke = currentColor;
        leaderLine.setAttribute('stroke', currentColor);
      }, {passive:true});
      pinPalette.appendChild(sw);
    });

    filterToggles.innerHTML = '';
    // All
    const labAll = document.createElement('label');
    labAll.className='ft-all';
    const cAll = document.createElement('input'); cAll.type='checkbox'; cAll.checked=true;
    labAll.appendChild(cAll); labAll.append('All');
    cAll.addEventListener('change',()=>{
      const on = !!cAll.checked;
      Object.keys(filterVisible).forEach(h=>filterVisible[h]=on);
      filterToggles.querySelectorAll('input[data-hex]').forEach(cb=>cb.checked=on);
      applyFilter();
    });
    filterToggles.appendChild(labAll);
    // each color
    PALETTE.forEach(c=>{
      const lab = document.createElement('label'); lab.className='ft-item';
      const cb = document.createElement('input'); cb.type='checkbox'; cb.checked=true; cb.dataset.hex=c.hex;
      const dot = document.createElement('i'); dot.className='dot'; dot.style.background=c.hex;
      lab.appendChild(cb); lab.appendChild(dot);
      cb.addEventListener('change',()=>{
        filterVisible[c.hex] = !!cb.checked;
        cAll.checked = Object.values(filterVisible).every(Boolean);
        applyFilter();
      });
      filterToggles.appendChild(lab);
    });
  }
  setupPalette();

  // project to canvas
  function projectToCanvas(vec3){
    const THREE = app.viewer.THREE;
    const v = new THREE.Vector3(vec3.x, vec3.y, vec3.z).project(app.viewer.camera);
    const el = app.viewer.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (svg.getAttribute('width') != String(w)) svg.setAttribute('width', String(w));
    if (svg.getAttribute('height') != String(h)) svg.setAttribute('height', String(h));
    return { x: ( v.x * .5 + .5) * w, y: (-v.y * .5 + .5) * h };
  }
  function updateLeaderToOverlay(){
    if (!selected || overlay.style.display==='none'){ leaderLine.setAttribute('opacity','0'); halo.style.opacity=0; return; }
    const canvasRect = app.viewer.renderer.domElement.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const ax = overlayRect.left - canvasRect.left + 10;
    const ay = overlayRect.top  - canvasRect.top  + overlayRect.height/2;
    const p = projectToCanvas(selected.obj.position);
    leaderLine.setAttribute('x1', p.x); leaderLine.setAttribute('y1', p.y);
    leaderLine.setAttribute('x2', ax); leaderLine.setAttribute('y2', ay);
    leaderLine.setAttribute('opacity','1');
    halo.setAttribute('cx', p.x); halo.setAttribute('cy', p.y);
  }
  window.addEventListener('resize', updateLeaderToOverlay);
  (function raf(){ updateLeaderToOverlay(); requestAnimationFrame(raf); })();

  function renderCapList(){
    capList.innerHTML = pins.map(p=>`
      <div class="caprow" data-id="${p.id}">
        <i class="dot" style="background:${p.color}"></i>
        <span class="capttl">${p.title||'(untitled)'}</span>
      </div>`).join('');
  }

  function showOverlay(rec){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${rec.title||'(untitled)'}</strong>` + (rec.body? `<div class="ob">${rec.body}</div>` : '');
    updateLeaderToOverlay();
  }
  function hideOverlay(){ overlay.style.display='none'; leaderLine.setAttribute('opacity','0'); halo.style.opacity=0; halo.style.animation='none'; }

  function selectPin(rec){
    selected = rec || null;
    if (!rec){ hideOverlay(); return; }
    titleInput.value = rec.title || '';
    bodyInput.value  = rec.body  || '';
    leaderLine.setAttribute('stroke', rec.color || currentColor);
    halo.style.stroke = rec.color || currentColor;
    halo.style.opacity=1; halo.style.animation='lmyPulse 1.2s ease-out infinite';
    showOverlay(rec);
  }

  const uuid = ()=>'p_'+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
  function addPinAtPosition(pos, init={}, opts={}){
    const THREE = app.viewer.THREE;
    const color = init.color || currentColor;
    const pinObj = new THREE.Mesh(new THREE.SphereGeometry(0.01,8,8), new THREE.MeshBasicMaterial({color}));
    pinObj.position.copy(pos);
    app.viewer.scene.add(pinObj);
    const rec = { id: init.id||uuid(), obj: pinObj, title:init.title||'', body:init.body||'', imageId:init.imageId||'', color };
    pins.push(rec); renderCapList(); selectPin(rec);
    if (!opts.skipSave) scheduleSave();
    return rec;
  }

  function applyFilter(){
    for (const p of pins){
      const vis = !!filterVisible[p.color];
      p.obj.visible = vis;
      if (selected && selected.id===p.id && !vis){ selected=null; hideOverlay(); }
    }
  }

  // events
  capList.addEventListener('click', (e)=>{
    const id = e.target.closest('[data-id]')?.dataset?.id;
    if (!id) return;
    const rec = pins.find(p=>p.id===id);
    if (rec) selectPin(rec);
  }, {passive:true});

  // shift+click で追加（+Pinボタンは今は残す）
  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (!e.shiftKey) return;
    const hit = app.viewer.raycastFromClientXY(e.clientX, e.clientY);
    if (hit) addPinAtPosition(hit.point);
  });

  titleInput.addEventListener('input', ()=>{ if (selected){ selected.title=titleInput.value; renderCapList(); scheduleSave(); } });
  bodyInput .addEventListener('input', ()=>{ if (selected){ selected.body =bodyInput.value ; scheduleSave(); } });
  btnAdd?.addEventListener('click', ()=>{
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const hit = app.viewer.raycastFromClientXY(rect.left+rect.width/2, rect.top+rect.height/2);
    if (hit) addPinAtPosition(hit.point);
  });

  // sheet
  async function populateSheetSelect(){
    const titles = await listSheetTitles(spreadsheetId);
    sheetSelect.innerHTML = titles.map(t=>`<option value="${t}">${t}</option>`).join('');
    if (!titles.includes(sheetName)) sheetName = titles[0] || 'Pins';
    sheetSelect.value = sheetName;
  }
  async function restorePins(){
    pins.forEach(p=> app.viewer.scene.remove(p.obj));
    pins.length = 0; renderCapList(); selectPin(null);
    const list = await loadPins(spreadsheetId, sheetName);
    for (const p of list){
      const pos = new app.viewer.THREE.Vector3(p.x,p.y,p.z);
      addPinAtPosition(pos, p, {skipSave:true});
    }
    applyFilter();
  }
  sheetSelect.addEventListener('change', async ()=>{
    sheetName = sheetSelect.value||'Pins';
    if (!spreadsheetId) return;
    await ensurePinsHeader(spreadsheetId, sheetName);
    await restorePins();
  });
  btnNewSheet.addEventListener('click', async ()=>{
    try{
      if (!spreadsheetId){
        const glbId = app.state?.currentGLBId;
        if (!glbId) throw new Error('Load a GLB first to locate its folder.');
        const res = await ensureSpreadsheetForFile(glbId);
        spreadsheetId = res.spreadsheetId;
      }
      const base = prompt('New sheet name?', 'Pins-' + new Date().toISOString().slice(0,10));
      if (!base) return;
      sheetName = base;
      await ensurePinsHeader(spreadsheetId, sheetName);
      await populateSheetSelect();
      sheetSelect.value = sheetName;
      await restorePins();
    }catch(e){ console.error('[pins] create sheet failed', e); alert('Failed to create sheet: '+(e?.message||e)); }
  });

  window.addEventListener('lmy:model-loaded', async ()=>{
    try{
      const glbId = app.state?.currentGLBId;
      const res = await ensureSpreadsheetForFile(glbId);
      spreadsheetId = res.spreadsheetId;
      await ensurePinsHeader(spreadsheetId, sheetName);
      await populateSheetSelect();
      await restorePins();
    }catch(e){ console.error('[pins] init failed', e); }
  });

  // save (debounced)
  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
  const scheduleSave = debounce(async ()=>{
    if (!spreadsheetId) return;
    try{
      const serial = pins.map(p=>({ id:p.id, x:p.obj.position.x, y:p.obj.position.y, z:p.obj.position.z, title:p.title, body:p.body, imageId:p.imageId, color:p.color }));
      await savePins(spreadsheetId, sheetName, serial);
      console.log('[pins] saved', serial.length, 'to sheet', sheetName);
    }catch(e){ console.error('[pins] save failed', e); }
  }, 300);
}
