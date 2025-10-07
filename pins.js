// pins.js — Palette + per-color visibility toggles (A+B案), compact & robust
import { ensureSpreadsheetForFile, ensurePinsHeader, listSheetTitles, loadPins, savePins } from './sheets_api.js?v=20251004s3';
import { downloadImageAsBlob } from './utils_drive_images.js?v=20251004img2';

const PALETTE = [
  { key:'sky',   hex:'#55ccff' },
  { key:'amber', hex:'#ffcc55' },
  { key:'lime',  hex:'#a3e635' },
  { key:'rose',  hex:'#f43f5e' },
  { key:'violet',hex:'#8b5cf6' },
  { key:'slate', hex:'#94a3b8' }
];

export function setupPins(app){
  // ------- cache DOM -------
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

  if (!overlay || !pinPalette || !filterToggles) {
    console.error('[pins] required elements missing');
    return;
  }

  // ------- state -------
  const pins = []; // {id,obj,title,body,imageId,color}
  let selected = null;
  let spreadsheetId = null;
  let sheetName = 'Pins';
  let currentColor = PALETTE[0].hex;
  const imageCache = new Map(); // fileId -> objectURL
  const filterVisible = Object.fromEntries(PALETTE.map(c=>[c.hex,true])); // per color visibility

  // ------- small utils -------
  const uuid = ()=>'p_'+Math.random().toString(36).slice(2,10)+Math.random().toString(36).slice(2,10);
  const stage = document.getElementById('stage');
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

  // ------- UI builders -------
  function setupPalette(){
    pinPalette.innerHTML = '';
    PALETTE.forEach((c,i)=>{
      const sw = document.createElement('div');
      sw.className = 'sw'+(i===0?' active':'');
      sw.title = c.key;
      sw.style.background = c.hex;
      sw.dataset.hex = c.hex;
      sw.addEventListener('click',()=>{
        pinPalette.querySelectorAll('.sw').forEach(x=>x.classList.remove('active'));
        sw.classList.add('active');
        currentColor = c.hex;
        if (selected){
          leaderLine.setAttribute('stroke', currentColor);
          halo.style.stroke = currentColor;
        }
      });
      pinPalette.appendChild(sw);
    });

    // visibility toggles (checkbox + dot)
    filterToggles.innerHTML = '';
    // “All” master
    const labAll = document.createElement('label');
    const cAll = document.createElement('input');
    cAll.type = 'checkbox'; cAll.checked = true;
    labAll.appendChild(cAll); labAll.append('All');
    cAll.addEventListener('change',()=>{
      const on = !!cAll.checked;
      Object.keys(filterVisible).forEach(h=>filterVisible[h]=on);
      filterToggles.querySelectorAll('input[data-hex]').forEach(cb=>cb.checked=on);
      applyFilter();
    });
    filterToggles.appendChild(labAll);

    // per color
    PALETTE.forEach(c=>{
      const lab = document.createElement('label');
      const cb = document.createElement('input');
      cb.type='checkbox'; cb.checked = true; cb.dataset.hex = c.hex;
      const dot = document.createElement('span'); dot.className='dot'; dot.style.background=c.hex;
      lab.appendChild(cb); lab.appendChild(dot);
      cb.addEventListener('change',()=>{
        filterVisible[c.hex] = !!cb.checked;
        // sync “All”
        cAll.checked = Object.values(filterVisible).every(Boolean);
        applyFilter();
      });
      filterToggles.appendChild(lab);
    });
  }
  setupPalette();

  // overlay content
  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${title??''}</strong>` + (body? `<div style="margin-top:.25rem;white-space:pre-wrap">${body}</div>` : '');
    if (imgUrl){
      const im = new Image(); im.src = imgUrl; im.style.marginTop='.5rem'; im.style.maxWidth='100%'; overlay.appendChild(im);
    }
    updateLeaderToOverlay();
  }
  function hideOverlay(){ overlay.style.display='none'; leaderLine.setAttribute('opacity','0'); halo.style.opacity=0; halo.style.animation='none'; }

  function projectToCanvas(vec3){
    const THREE = app.viewer.THREE;
    const v = new THREE.Vector3(vec3.x, vec3.y, vec3.z);
    v.project(app.viewer.camera);
    const el = app.viewer.renderer.domElement;
    const w = el.clientWidth, h = el.clientHeight;
    if (svg.getAttribute('width') != String(w)) svg.setAttribute('width', String(w));
    if (svg.getAttribute('height') != String(h)) svg.setAttribute('height', String(h));
    const x = ( v.x *  0.5 + 0.5) * w;
    const y = (-v.y *  0.5 + 0.5) * h;
    return { x, y };
  }
  function updateLeaderToOverlay(){
    if (!selected || overlay.style.display==='none'){ leaderLine.setAttribute('opacity','0'); halo.style.opacity=0; return; }
    const canvasRect = app.viewer.renderer.domElement.getBoundingClientRect();
    const overlayRect = overlay.getBoundingClientRect();
    const ax = overlayRect.left - canvasRect.left + 10;
    const ay = overlayRect.top  - canvasRect.top  + overlayRect.height/2;
    const p = projectToCanvas(selected.obj.position);
    leaderLine.setAttribute('x1', String(p.x));
    leaderLine.setAttribute('y1', String(p.y));
    leaderLine.setAttribute('x2', String(ax));
    leaderLine.setAttribute('y2', String(ay));
    leaderLine.setAttribute('opacity','1');
    halo.setAttribute('cx', String(p.x));
    halo.setAttribute('cy', String(p.y));
  }
  window.addEventListener('resize', updateLeaderToOverlay);
  (function raf(){ updateLeaderToOverlay(); requestAnimationFrame(raf); })();

  // -------- pins I/O --------
  function renderCapList(){
    capList.innerHTML = pins.map(p=>`
      <div class="row" data-id="${p.id}" style="padding:.4rem .5rem;border-bottom:1px solid #262630;cursor:pointer">
        <span style="display:inline-block;width:10px;height:10px;background:${p.color};border-radius:999px"></span>
        <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title||'(untitled)'}</span>
      </div>`).join('');
  }

  function selectPin(rec){
    selected = rec || null;
    if (!rec){ hideOverlay(); return; }
    titleInput.value = rec.title || '';
    bodyInput.value = rec.body || '';
    leaderLine.setAttribute('stroke', rec.color || currentColor);
    halo.style.stroke = rec.color || currentColor;
    halo.style.opacity = 1; halo.style.animation = 'lmyPulse 1.2s ease-out infinite';
    showOverlay({ title: rec.title||'(untitled)', body: rec.body||'', imgUrl: '' });
  }

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
  function addPinFromHit(hit){ addPinAtPosition(hit.point, {}); }

  function applyFilter(){
    for (const p of pins){
      const vis = !!filterVisible[p.color];
      p.obj.visible = vis;
      if (selected && selected.id===p.id && !vis){ selected=null; hideOverlay(); }
    }
  }

  // ---------- events ----------
  capList.addEventListener('click', (e)=>{
    const id = e.target.closest('[data-id]')?.dataset?.id;
    if (!id) return;
    const rec = pins.find(p=>p.id===id);
    if (rec) selectPin(rec);
  });

  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (!e.shiftKey) return;
    const hit = app.viewer.raycastFromClientXY(e.clientX, e.clientY);
    if (hit) addPinFromHit(hit);
  });

  btnAdd?.addEventListener('click', ()=>{
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const hit = app.viewer.raycastFromClientXY(rect.left+rect.width/2, rect.top+rect.height/2);
    if (hit) addPinFromHit(hit);
  });

  titleInput.addEventListener('input', ()=>{ if (selected){ selected.title=titleInput.value; renderCapList(); scheduleSave(); } });
  bodyInput .addEventListener('input', ()=>{ if (selected){ selected.body =bodyInput.value ; scheduleSave(); } });

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
