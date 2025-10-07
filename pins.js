// pins.js — per-pin delete (fixed JS syntax) + remove 'clear all' button
import { ensureSpreadsheetForFile, ensurePinsHeader, listSheetTitles, loadPins, savePins } from './sheets_api.js?v=20251004s3';
import { downloadImageAsBlob } from './utils_drive_images.js?v=20251004img2';

const PALETTE = [
  { key:'amber', hex:'#ffcc55' },
  { key:'sky',   hex:'#55ccff' },
  { key:'lime',  hex:'#a3e635' },
  { key:'rose',  hex:'#f43f5e' },
  { key:'violet',hex:'#8b5cf6' },
  { key:'slate', hex:'#94a3b8' }
];

export function setupPins(app){
  const overlay = document.getElementById('overlay');
  const titleInput = document.getElementById('capTitle');
  const bodyInput  = document.getElementById('capBody');
  const btnAdd = document.getElementById('btnAddPin');
  const btnClear = document.getElementById('btnClearPins'); // will remove
  const imgGrid = document.getElementById('imgGrid');
  const sheetSelect = document.getElementById('sheetSelect');
  const btnNewSheet = document.getElementById('btnNewSheet');
  const pinFilter = document.getElementById('pinFilter');
  const capList = document.getElementById('capList');
  const pinPalette = document.getElementById('pinPalette');

  // Remove dangerous "clear all pins" button if present
  if (btnClear) btnClear.remove();

  // leader svg (created if missing) + halo
  const stage = document.getElementById('stage') || app.viewer.renderer.domElement.parentElement;
  let svg = document.getElementById('leader');
  if (!svg){
    svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('id','leader');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.pointerEvents = 'none';
    svg.style.zIndex = '5';
    stage.appendChild(svg);
  }
  let leaderLine = document.getElementById('leaderLine');
  if (!leaderLine){
    leaderLine = document.createElementNS('http://www.w3.org/2000/svg','line');
    leaderLine.setAttribute('id','leaderLine');
    leaderLine.setAttribute('stroke','#ffcc55');
    leaderLine.setAttribute('stroke-width','2');
    leaderLine.setAttribute('opacity','0');
    svg.appendChild(leaderLine);
  }
  let halo = document.getElementById('leaderHalo');
  if (!halo){
    halo = document.createElementNS('http://www.w3.org/2000/svg','circle');
    halo.setAttribute('id','leaderHalo');
    halo.setAttribute('cx','0'); halo.setAttribute('cy','0'); halo.setAttribute('r','8');
    halo.style.fill = 'none'; halo.style.stroke = '#ffd166'; halo.style.strokeWidth = '2'; halo.style.opacity = '0';
    svg.appendChild(halo);
  }
  if (!document.getElementById('lmy-style-ui')){
    const st = document.createElement('style'); st.id='lmy-style-ui';
    st.textContent = `
      @keyframes lmyPulse {0%{r:8;opacity:.9} 70%{r:18;opacity:0} 100%{r:18;opacity:0}}
      .lmy-flash { outline:2px solid #facc15; box-shadow:0 0 0 4px rgba(250,204,21,.15); transition:all .35s }
      .lmy-check { position:absolute; right:6px; bottom:6px; width:18px; height:18px; border-radius:999px; background:#16a34a; color:white; display:grid; place-items:center; font-size:12px; box-shadow:0 2px 6px rgba(0,0,0,.4) }
      .lmy-toast { position:absolute; transform:translate(-8px, -8px); right:0; bottom:0; background:rgba(0,0,0,.75); color:#fff; padding:.25rem .5rem; border:1px solid #333; border-radius:.35rem; font-size:12px; opacity:0; transition:opacity .18s, transform .18s }
      .lmy-toast.show { opacity:1; transform:translate(0,0) }
      .lmy-fly { position:fixed; z-index:9999; pointer-events:none; border-radius:.35rem; overflow:hidden; box-shadow:0 6px 24px rgba(0,0,0,.35) }
      .lmy-row { display:flex; align-items:center; justify-content:space-between; gap:.5rem; }
      .lmy-row .l { display:flex; align-items:center; gap:.35rem; min-width:0 }
      .lmy-row .r button { opacity:.75; background:#111; border:1px solid #333; color:#ddd; border-radius:.35rem; padding:.15rem .35rem; font-size:12px; }
      .lmy-row .r button:hover { opacity:1; background:#1a1a1a }
      .lmy-row img.thumb { width:18px; height:18px; object-fit:cover; border-radius:3px }
      .lmy-overlay-actions { position:absolute; right:8px; top:6px; display:flex; gap:6px }
      .lmy-icon-btn { background:#111; border:1px solid #333; color:#ddd; border-radius:.35rem; width:22px; height:22px; display:grid; place-items:center; font-size:12px; opacity:.85 }
      .lmy-icon-btn:hover { opacity:1; background:#1a1a1a }
    `;
    document.head.appendChild(st);
  }

  const pins = []; // {id,obj,title,body,imageId,color}
  let selected = null;
  let spreadsheetId = null;
  let sheetName = 'Pins';
  let currentColor = PALETTE[0].hex;
  const imageCache = new Map(); // fileId -> objectURL

  function setupPalette(){
    pinPalette.innerHTML = PALETTE.map((c,i)=>`<div class="sw${i===0?' active':''}" data-hex="${c.hex}" title="${c.key}" style="background:${c.hex};width:24px;height:24px;border-radius:999px;border:2px solid #0003;cursor:pointer;box-shadow:0 0 0 2px #222"></div>`).join('');
    pinPalette.querySelectorAll('.sw').forEach(sw=> sw.addEventListener('click', ()=>{
      pinPalette.querySelectorAll('.sw').forEach(x=> x.classList.remove('active'));
      sw.classList.add('active');
      currentColor = sw.dataset.hex;
      if (selected){
        leaderLine.setAttribute('stroke', currentColor);
        halo.style.stroke = currentColor;
      }
    }));
    pinFilter.innerHTML = '<option value="all">(All)</option>' + PALETTE.map(c=>`<option value="${c.hex}">${c.key}</option>`).join('');
  }
  setupPalette();

  // draggable overlay
  (function makeDraggable(){
    let dragging=false, sx=0, sy=0, startLeft=0, startTop=0;
    overlay.style.left='12px'; overlay.style.bottom='12px';
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

  function resolveImageURL(rec){
    if (!rec?.imageId) return '';
    if (/^https?:\/\//i.test(rec.imageId)) return rec.imageId;
    const fid = rec.imageId;
    if (imageCache.has(fid)) return imageCache.get(fid);
    (async ()=>{
      try{
        const blob = await downloadImageAsBlob(fid);
        const url = URL.createObjectURL(blob);
        const prev = imageCache.get(fid);
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        imageCache.set(fid, url);
        if (selected && selected.imageId === fid){
          showOverlay({ title:selected.title, body:selected.body, imgUrl:url });
        }
      }catch(e){ console.warn('[pins] image resolve failed', e); }
    })();
    return '';
  }

  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    const header = document.createElement('div');
    header.style.position='relative';
    header.innerHTML = `<strong>${title??''}</strong>`;
    const actions = document.createElement('div'); actions.className='lmy-overlay-actions';
    const delBtn = document.createElement('button'); delBtn.className='lmy-icon-btn'; delBtn.title='Delete pin (⌫/Del)'; delBtn.textContent='🗑';
    delBtn.addEventListener('click', ()=>{ if (selected) deletePin(selected); });
    actions.appendChild(delBtn);
    header.appendChild(actions);
    overlay.innerHTML = '';
    overlay.appendChild(header);
    const bodyDiv = document.createElement('div'); bodyDiv.style.marginTop='.25rem'; bodyDiv.style.whiteSpace='pre-wrap'; bodyDiv.textContent = body??'';
    overlay.appendChild(bodyDiv);
    if (imgUrl){
      const im = new Image(); im.src = imgUrl; im.style.marginTop='.5rem'; im.style.maxWidth='100%'; im.onerror = ()=>{ im.style.opacity=.35; im.title='load failed'; };
      overlay.appendChild(im);
    }
    updateLeaderToOverlay();
  }
  function showToast(msg='Saved'){
    let t = overlay.querySelector('.lmy-toast');
    if (!t){ t=document.createElement('div'); t.className='lmy-toast'; overlay.appendChild(t); }
    t.textContent = msg;
    t.classList.add('show');
    setTimeout(()=> t.classList.remove('show'), 800);
  }
  function hideOverlay(){ overlay.style.display='none'; leaderLine.setAttribute('opacity','0'); halo.style.opacity = 0; halo.style.animation = 'none'; }

  function renderCapList(){
    capList.innerHTML = pins.map(p=>{
      const thumb = (/^https?:\/\//i.test(p.imageId) ? p.imageId : (p.imageId && imageCache.get(p.imageId))) || '';
      const img = thumb ? `<img class="thumb" src="${thumb}">` : '';
      return `<div class="row lmy-row" data-id="${p.id}" style="padding:.4rem .5rem;border-bottom:1px solid #262630;cursor:pointer">
        <div class="l">
          <span style="display:inline-block;width:10px;height:10px;background:${p.color};border-radius:999px"></span>
          ${img}
          <span class="title" style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.title || '(untitled)'}</span>
        </div>
        <div class="r">
          <button class="btn-del" title="Delete">🗑</button>
        </div>
      </div>`;
    }).join('');
  }

  // list click (select or delete)
  capList.addEventListener('click', (e)=>{
    const row = e.target.closest('[data-id]'); if (!row) return;
    const id = row.getAttribute('data-id');
    const rec = pins.find(p=> p.id===id);
    if (!rec) return;
    if (e.target.closest('.btn-del')){
      deletePin(rec);
      e.stopPropagation();
      return;
    }
    selectPin(rec);
  });

  // keyboard delete
  window.addEventListener('keydown', (e)=>{
    if ((e.key === 'Delete' || e.key === 'Backspace') && selected){
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      if (['INPUT','TEXTAREA'].includes(tag)) return;
      e.preventDefault();
      deletePin(selected);
    }
  });

  function selectPin(rec){
    selected = rec || null;
    if (!rec){ hideOverlay(); return; }
    titleInput.value = rec.title || '';
    bodyInput.value = rec.body || '';
    const color = rec.color || currentColor;
    rec.obj.material.color.set(color);
    leaderLine.setAttribute('stroke', color);
    halo.style.stroke = color;
    halo.style.opacity = 1;
    halo.style.animation = 'lmyPulse 1.2s ease-out infinite';
    const url = resolveImageURL(rec);
    showOverlay({ title: rec.title||'(untitled)', body: rec.body||'', imgUrl: url });
  }

  function addPinAtPosition(pos, init={}, opts={}){
    const THREE = app.viewer.THREE;
    const color = init.color || currentColor;
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
    if (!opts.skipSave) scheduleSave();
    return rec;
  }
  function addPinFromHit(hit){ addPinAtPosition(hit.point, {}); }

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
    if (!selected || (overlay && overlay.style && overlay.style.display==='none')){ try{ leaderLine.setAttribute('opacity','0'); halo.style.opacity=0; }catch(e){} return; }

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
  (function lineTick(){ updateLeaderToOverlay(); requestAnimationFrame(lineTick); })();

  function applyFilter(){

    const f = pinFilter.value;
    for (const p of pins){
      const vis = (f==='all') || (p.color.toLowerCase() === f.toLowerCase());
      p.obj.visible = vis;
      if (selected && selected.id===p.id && !vis) { selected = null; hideOverlay(); }
  // ensure selection & guide fully cleared if hidden by filter
  if (!selected){
    try{ leaderLine && leaderLine.setAttribute('opacity','0'); }catch(e){}
    try{ if (typeof hideOverlay==='function') hideOverlay(); }catch(e){}
  }
}

  }
  pinFilter.addEventListener('change', applyFilter);

// -- color chips for pin filter (matches PALETTE keys)
const FILTER_COLORS = [
  {key:'all',    hex:'#bbb',     title:'All'},
  {key:'amber',  hex:'#ffcc55',  title:'amber'},
  {key:'sky',    hex:'#55ccff',  title:'sky'},
  {key:'lime',   hex:'#a3e635',  title:'lime'},
  {key:'rose',   hex:'#f43f5e',  title:'rose'},
  {key:'violet', hex:'#8b5cf6',  title:'violet'},
  {key:'slate',  hex:'#94a3b8',  title:'slate'},
];

(function setupFilterChips(){
  const row = document.getElementById('pinFilterChips');
  const sel = document.getElementById('pinFilter');
  if (!row) return;
  row.innerHTML = '';
  FILTER_COLORS.forEach(c=>{
    const b = document.createElement('button');
    b.className = 'chip'; b.dataset.key = c.key; b.title = c.title;
    b.style.background = c.hex;
    b.addEventListener('click', ()=>{
      sel && (sel.value = (c.key==='all' ? 'all' : c.key));
      applyFilter();
      row._highlight && row._highlight();
    });
    row.appendChild(b);
  });
  row._highlight = function(){
    const cur = (sel && sel.value) || 'all';
    const k = String(cur).toLowerCase();
    [...row.children].forEach(el=>{
      el.classList.toggle('active', el.dataset.key === (k==='all'?'all':k));
    });
  };
  row._highlight();
})();


  // click on canvas
  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (e.shiftKey){
      const hit = app.viewer.raycastFromClientXY(e.clientX, e.clientY);
      if (hit) addPinFromHit(hit);
      return;
    }
    if (!pins.length) return;
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
      if (d2 < bestD2) { best = p; bestD2 = d2; }
    }
    if (Math.sqrt(bestD2) < 24) selectPin(best);
  });

  btnAdd && btnAdd.addEventListener('click', ()=>{
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const hit = app.viewer.raycastFromClientXY(cx, cy);
    if (hit) addPinFromHit(hit);
  });

  function deletePin(rec){
    try{
      const obj = rec.obj;
      const t0 = performance.now();
      function tick(){
        const dt = (performance.now()-t0)/180;
        const s = Math.max(0, 1 - dt);
        obj.scale.setScalar(s);
        if (s>0){ requestAnimationFrame(tick); }
        else { app.viewer.scene.remove(obj); }
      }
      requestAnimationFrame(tick);
    }catch(e){ app.viewer.scene.remove(rec.obj); }
    const idx = pins.findIndex(p=> p.id===rec.id);
    if (idx>=0) pins.splice(idx,1);
    if (selected && selected.id===rec.id) { selected=null; hideOverlay(); }
    renderCapList();
    scheduleSave();
  }

  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
  const scheduleSave = debounce(async ()=>{
    if (!spreadsheetId) return;
    try{
      const serial = pins.map(p => ({ id:p.id, x:p.obj.position.x, y:p.obj.position.y, z:p.obj.position.z, title:p.title, body:p.body, imageId:p.imageId, color:p.color }));
      await savePins(spreadsheetId, sheetName, serial);
      showToast('Saved');
      console.log('[pins] saved', serial.length, 'to sheet', sheetName);
    }catch(e){ console.error('[pins] save failed', e); }
  }, 400);

  titleInput.addEventListener('input', ()=>{ if (selected){ selected.title = titleInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl: resolveImageURL(selected) }); renderCapList(); scheduleSave(); } });
  bodyInput.addEventListener('input', ()=>{ if (selected){ selected.body = bodyInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl: resolveImageURL(selected) }); scheduleSave(); } });

  // image attach feedback (flash/check/fly) with correct JS
  imgGrid.addEventListener('click', async (e)=>{
    const img = e.target.closest('img'); if (!img || !selected) return;
    const card = img.closest('.card');
    if (card){
      card.classList.add('lmy-flash'); setTimeout(()=> card.classList.remove('lmy-flash'), 350);
      let chk = card.querySelector('.lmy-check');
      if (!chk){ chk = document.createElement('div'); chk.className='lmy-check'; chk.textContent='✓'; card.style.position='relative'; card.appendChild(chk); setTimeout(()=> chk.remove(), 600); }
    }
    try{
      const rect = img.getBoundingClientRect();
      const fly = img.cloneNode();
      fly.className = 'lmy-fly';
      fly.style.left = rect.left + 'px'; fly.style.top = rect.top + 'px';
      fly.style.width = rect.width + 'px'; fly.style.height = rect.height + 'px';
      document.body.appendChild(fly);
      const ov = overlay.getBoundingClientRect();
      const scale = Math.min(220 / rect.width, 220 / rect.height, 1.3);
      fly.animate([
        { transform:`translate(0,0) scale(1)`, opacity:.95 },
        { transform:`translate(${ov.left-rect.left+16}px, ${ov.top-rect.top+16}px) scale(${scale})`, opacity:.2 }
      ], { duration: 420, easing:'cubic-bezier(.22,.61,.36,1)' }).onfinish = ()=> fly.remove();
    }catch(e){ /* ignore */ }

    const fid = img.dataset.id;
    if (fid){
      try{
        const blob = await downloadImageAsBlob(fid);
        const url = URL.createObjectURL(blob);
        const prev = imageCache.get(fid);
        if (prev && typeof prev === 'string' && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        imageCache.set(fid, url);
        selected.imageId = fid;
        showOverlay({ title:selected.title, body:selected.body, imgUrl:url });
        renderCapList();
        scheduleSave();
      }catch(err){ console.error('[pins] image fetch failed', err); }
    }else{
      selected.imageId = img.src;
      showOverlay({ title:selected.title, body:selected.body, imgUrl: img.src });
      renderCapList();
      scheduleSave();
    }
  });

  async function populateSheetSelect(){
    const titles = await listSheetTitles(spreadsheetId);
    sheetSelect.innerHTML = titles.map(t=>`<option value="${t}">${t}</option>`).join('');
    if (!titles.includes(sheetName)) sheetName = titles[0] || 'Pins';
    sheetSelect.value = sheetName;
  }

  async function restorePins(){
    pins.forEach(p=> app.viewer.scene.remove(p.obj));
    pins.length = 0;
    renderCapList();
    selectPin(null);
    const list = await loadPins(spreadsheetId, sheetName);
    for (const p of list){
      const pos = new app.viewer.THREE.Vector3(p.x, p.y, p.z);
      addPinAtPosition(pos, p, { skipSave:true });
    }
    applyFilter();
    console.log('[pins] restored', list.length, 'pins from sheet', sheetName);
  }

  sheetSelect.addEventListener('change', async ()=>{
    sheetName = sheetSelect.value || 'Pins';
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
    }catch(e){
      console.error('[pins] create sheet failed', e);
      alert('Failed to create sheet: ' + (e?.message || e));
    }
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
}


try{
  (function(){
    const row = document.getElementById('pinFilterChips');
    if (!row) return;
    row._highlight = function(){
      const sel = document.getElementById('pinFilter');
      const cur = (typeof state !== 'undefined' && state && state.filter)
               || (sel && sel.value)
               || 'All';
      const k = String(cur).toLowerCase();
      [...row.children].forEach(el=>{
        el.classList.toggle('active', el.dataset.key === (k==='all'?'all':k));
      });
    };
    row._highlight();
  })();
}catch(e){ console.warn('[pins] chips highlight fix failed', e); }
