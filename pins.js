import { ensureSpreadsheetForFile, ensurePinsHeader, listSheetTitles, loadPins, savePins } from './sheets_api.js?v=20251004s2';
import { downloadImageAsBlob } from './utils_drive_images.js?v=20251004img2';

export function setupPins(app){
  const overlay = document.getElementById('overlay');
  const titleInput = document.getElementById('capTitle');
  const bodyInput  = document.getElementById('capBody');
  const btnAdd = document.getElementById('btnAddPin');
  const btnClear = document.getElementById('btnClearPins');
  const imgGrid = document.getElementById('imgGrid');
  const leaderLine = document.getElementById('leaderLine');
  const sheetSelect = document.getElementById('sheetSelect');
  const btnNewSheet = document.getElementById('btnNewSheet');
  const pinColor = document.getElementById('pinColor');
  const pinFilter = document.getElementById('pinFilter');
  const capList = document.getElementById('capList');

  const pins = []; // {id,obj,title,body,imageId,color}
  let selected = null;
  let spreadsheetId = null;
  let sheetName = 'Pins';

  // draggable overlay
  (function makeDraggable(){
    let dragging=false, sx=0, sy=0, startLeft=0, startTop=0;
    overlay.style.left='12px'; overlay.style.bottom='12px'; // default
    overlay.addEventListener('mousedown', (e)=>{ dragging=true; sx=e.clientX; sy=e.clientY; const r=overlay.getBoundingClientRect(); startLeft=r.left; startTop=r.top; e.preventDefault(); });
    window.addEventListener('mouseup', ()=> dragging=false);
    window.addEventListener('mousemove', (e)=>{
      if (!dragging) return;
      const dx=e.clientX-sx, dy=e.clientY-sy;
      overlay.style.left = (startLeft + dx) + 'px';
      overlay.style.top  = (startTop + dy) + 'px';
      overlay.style.bottom = 'auto';
      updateLeaderToOverlay();
    });
  })();

  function uuid(){ return 'p_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10); }

  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${title??''}</strong><div style="margin-top:.25rem;white-space:pre-wrap">${body??''}</div>${imgUrl?`<img src="${imgUrl}">`:''}`;
    updateLeaderToOverlay();
  }
  function hideOverlay(){ overlay.style.display='none'; leaderLine.setAttribute('opacity','0'); }

  function renderCapList(){
    capList.innerHTML = pins.map(p=>`<div class="row" data-id="${p.id}" style="padding:.4rem .5rem;border-bottom:1px solid #262630;cursor:pointer">
      <span style="display:inline-block;width:10px;height:10px;background:${p.color};border-radius:999px;margin-right:.4rem;vertical-align:middle"></span>
      ${p.title || '(untitled)'}</div>`).join('');
  }

  capList.addEventListener('click', (e)=>{
    const item = e.target.closest('[data-id]'); if (!item) return;
    const id = item.getAttribute('data-id');
    const rec = pins.find(p=> p.id===id);
    if (rec) selectPin(rec);
  });

  function selectPin(rec){
    selected = rec || null;
    if (!rec){ hideOverlay(); return; }
    titleInput.value = rec.title || '';
    bodyInput.value = rec.body || '';
    rec.obj.material.color.set(rec.color || '#ffcc55');
    showOverlay({ title: rec.title||'(untitled)', body: rec.body||'', imgUrl: rec.imageId || '' });
  }

  function addPinAtPosition(pos, init={}){
    const THREE = app.viewer.THREE;
    const color = init.color || pinColor.value || '#ffcc55';
    const pinObj = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 8, 8),
      new THREE.MeshBasicMaterial({ color })
    );
    pinObj.position.copy(pos);
    app.viewer.scene.add(pinObj);

    const rec = {
      id: init.id || uuid(),
      obj: pinObj,
      title: init.title || '',
      body: init.body || '',
      imageId: init.imageId || '',
      color
    };
    pins.push(rec);
    renderCapList();
    selectPin(rec);
    scheduleSave();
    return rec;
  }
  function addPinFromHit(hit){ addPinAtPosition(hit.point, {}); }

  // leader line from pin to overlay
  function updateLeaderToOverlay(){
    if (!selected){ leaderLine.setAttribute('opacity','0'); return; }
    const rectStage = app.viewer.renderer.domElement.getBoundingClientRect();
    const rectOverlay = overlay.getBoundingClientRect();
    const ax = rectOverlay.left - rectStage.left + 10;
    const ay = rectOverlay.top - rectStage.top + rectOverlay.height/2;
    const p = app.viewer.projectToScreen(selected.obj.position);
    leaderLine.setAttribute('x1', String(p.x));
    leaderLine.setAttribute('y1', String(p.y));
    leaderLine.setAttribute('x2', String(ax));
    leaderLine.setAttribute('y2', String(ay));
    leaderLine.setAttribute('opacity','1');
  }
  window.addEventListener('resize', updateLeaderToOverlay);
  document.addEventListener('mousemove', ()=>{ if (selected && overlay.style.display!=='none') updateLeaderToOverlay(); });

  // Pin color filter
  function applyFilter(){
    const f = pinFilter.value;
    for (const p of pins){
      const vis = (f==='all') || (p.color.toLowerCase() === f.toLowerCase());
      p.obj.visible = vis;
      if (selected && selected.id===p.id && !vis) hideOverlay();
    }
  }
  pinFilter.addEventListener('change', applyFilter);

  // Click handlers
  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (e.shiftKey){
      const hit = app.viewer.raycastFromClientXY(e.clientX, e.clientY);
      if (hit) addPinFromHit(hit);
      return;
    }
    if (!pins.length) return;
    // nearest pin within 24px
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    let best = null, bestD2 = 1e9;
    const proj = new app.viewer.THREE.Vector3();
    for (const p of pins){
      if (!p.obj.visible) continue;
      proj.copy(p.obj.position).project(app.viewer.camera);
      const sx = (proj.x * 0.5 + 0.5) * rect.width;
      const sy = (-proj.y * 0.5 + 0.5) * rect.height;
      const d2 = (sx-mx)*(sx-mx)+(sy-my)*(sy-my);
      if (d2 < bestD2) { bestD2 = d2; best = p; }
    }
    if (Math.sqrt(bestD2) < 24) selectPin(best);
  });

  btnAdd.addEventListener('click', ()=>{
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const hit = app.viewer.raycastFromClientXY(cx, cy);
    if (hit) addPinFromHit(hit);
  });

  btnClear.addEventListener('click', ()=>{
    pins.forEach(p=> app.viewer.scene.remove(p.obj));
    pins.length = 0;
    renderCapList();
    selectPin(null);
    scheduleSave(true);
  });

  // overlay edits -> selected pin -> autosave (debounced)
  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
  const scheduleSave = debounce(async ()=>{
    if (!spreadsheetId) return;
    try{
      const serial = pins.map(p => ({ id:p.id, x:p.obj.position.x, y:p.obj.position.y, z:p.obj.position.z, title:p.title, body:p.body, imageId:p.imageId, color:p.color }));
      await savePins(spreadsheetId, sheetName, serial);
      console.log('[pins] saved', serial.length, 'to sheet', sheetName);
    }catch(e){ console.error('[pins] save failed', e); }
  }, 600);

  titleInput.addEventListener('input', ()=>{ if (selected){ selected.title = titleInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl:selected.imageId }); renderCapList(); scheduleSave(); } });
  bodyInput.addEventListener('input', ()=>{ if (selected){ selected.body = bodyInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl:selected.imageId }); scheduleSave(); } });
  imgGrid.addEventListener('click', async (e)=>{
    const img = e.target.closest('img'); if (!img || !selected) return;
    const fid = img.dataset.id;
    if (fid){ // fetch actual blob (HEIC→JPEG handled)
      try{
        const blob = await downloadImageAsBlob(fid);
        const url = URL.createObjectURL(blob);
        selected.imageId = fid;
        showOverlay({ title:selected.title, body:selected.body, imgUrl:url });
        scheduleSave();
      }catch(err){ console.error('[pins] image fetch failed', err); }
    }else{
      selected.imageId = img.src; showOverlay({ title:selected.title, body:selected.body, imgUrl: img.src }); scheduleSave();
    }
  });

  // Sheet selection
  sheetSelect.addEventListener('change', async ()=>{
    sheetName = sheetSelect.value || 'Pins';
    await ensurePinsHeader(spreadsheetId, sheetName);
    await restorePins();
  });
  btnNewSheet.addEventListener('click', async ()=>{
    const base = prompt('New sheet name?', 'Pins-' + new Date().toISOString().slice(0,10));
    if (!base) return;
    sheetName = base;
    await ensurePinsHeader(spreadsheetId, sheetName);
    await populateSheetSelect();
    sheetSelect.value = sheetName;
    await restorePins();
  });

  async function populateSheetSelect(){
    const titles = await listSheetTitles(spreadsheetId);
    sheetSelect.innerHTML = titles.map(t=>`<option value="${t}">${t}</option>`).join('');
    if (!titles.includes(sheetName)) sheetName = titles[0] || 'Pins';
    sheetSelect.value = sheetName;
  }

  async function restorePins(){
    // clear existing
    pins.forEach(p=> app.viewer.scene.remove(p.obj));
    pins.length = 0;
    renderCapList();
    selectPin(null);
    // load
    const list = await loadPins(spreadsheetId, sheetName);
    for (const p of list){
      const pos = new app.viewer.THREE.Vector3(p.x, p.y, p.z);
      addPinAtPosition(pos, p);
    }
    applyFilter();
    console.log('[pins] restored', list.length, 'pins from sheet', sheetName);
  }

  // When a model is loaded, Pins module handles sheet ensure/restore.
  window.addEventListener('lmy:model-loaded', async ()=>{
    // nothing extra here
  });
}
