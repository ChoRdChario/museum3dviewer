import { ensureSpreadsheetForFile, loadPins, savePins } from './sheets_api.js?v=20251004s1';

export function setupPins(app){
  const overlay = document.getElementById('overlay');
  const titleInput = document.getElementById('capTitle');
  const bodyInput  = document.getElementById('capBody');
  const btnAdd = document.getElementById('btnAddPin');
  const btnClear = document.getElementById('btnClearPins');
  const imgGrid = document.getElementById('imgGrid');

  const pins = []; // {id,obj,line,title,body,imageId, position:{x,y,z}}
  let selected = null;
  let spreadsheetId = null;

  function uuid(){ return 'p_' + Math.random().toString(36).slice(2,10) + Math.random().toString(36).slice(2,10); }

  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${title??''}</strong><div style="margin-top:.25rem;white-space:pre-wrap">${body??''}</div>${imgUrl?`<img src="${imgUrl}">`:''}`;
  }
  function hideOverlay(){ overlay.style.display='none'; }

  function selectPin(rec){
    pins.forEach(pp=>{ if (pp.line) pp.line.visible = false; });
    selected = rec || null;
    if (!rec){ hideOverlay(); return; }
    if (rec.line) rec.line.visible = true;
    titleInput.value = rec.title || '';
    bodyInput.value = rec.body || '';
    showOverlay({ title: rec.title||'(untitled)', body: rec.body||'', imgUrl: rec.imageId || '' });
  }

  function makeLeaderLine(from, to){
    const THREE = app.viewer.THREE;
    const points = [ from, to ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffcc55 });
    return new THREE.Line(geom, mat);
  }

  function addPinAtPosition(pos, init={}){
    const THREE = app.viewer.THREE;
    const pinObj = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 })
    );
    pinObj.position.copy(pos);
    app.viewer.scene.add(pinObj);

    const line = makeLeaderLine(pinObj.position, app.viewer.controls.target.clone());
    line.visible = false;
    app.viewer.scene.add(line);

    const rec = {
      id: init.id || uuid(),
      obj: pinObj,
      line,
      title: init.title || '',
      body: init.body || '',
      imageId: init.imageId || '',
      position: { x: pos.x, y: pos.y, z: pos.z }
    };
    pins.push(rec);
    selectPin(rec);
    scheduleSave();
    return rec;
  }

  function addPinFromHit(hit){
    addPinAtPosition(hit.point, {});
  }

  // click handlers
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
    pins.forEach(p=>{ app.viewer.scene.remove(p.obj); app.viewer.scene.remove(p.line); });
    pins.length = 0;
    selectPin(null);
    scheduleSave(true);
  });

  // overlay edits -> selected pin -> autosave (debounced)
  function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
  const scheduleSave = debounce(async (forceClear=false)=>{
    if (!spreadsheetId) return;
    try{
      const serial = pins.map(p => ({ id:p.id, x:p.obj.position.x, y:p.obj.position.y, z:p.obj.position.z, title:p.title, body:p.body, imageId:p.imageId }));
      await savePins(spreadsheetId, serial);
      console.log('[pins] saved', serial.length);
    }catch(e){
      console.error('[pins] save failed', e);
    }
  }, 600);

  titleInput.addEventListener('input', ()=>{
    if (selected){ selected.title = titleInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl:selected.imageId }); scheduleSave(); }
  });
  bodyInput.addEventListener('input', ()=>{
    if (selected){ selected.body = bodyInput.value; showOverlay({ title:selected.title, body:selected.body, imgUrl:selected.imageId }); scheduleSave(); }
  });
  imgGrid.addEventListener('click', (e)=>{
    const img = e.target.closest('img'); if (!img || !selected) return;
    selected.imageId = img.src; showOverlay({ title:selected.title, body:selected.body, imgUrl:selected.imageId }); scheduleSave();
  });

  // When a model is loaded: ensure spreadsheet in same folder, then load existing pins
  window.addEventListener('lmy:model-loaded', async ()=>{
    try{
      const glbId = (app.state && app.state.currentGLBId) || null;
      if (!glbId){ console.warn('[pins] no current GLB id'); return; }
      const res = await ensureSpreadsheetForFile(glbId);
      spreadsheetId = res.spreadsheetId;
      console.log('[pins] spreadsheet ready', res);
      // load and render
      const list = await loadPins(spreadsheetId);
      for (const p of list){
        const pos = new app.viewer.THREE.Vector3(p.x, p.y, p.z);
        addPinAtPosition(pos, p);
      }
      if (list.length) console.log('[pins] restored', list.length, 'pins');
    }catch(e){
      console.error('[pins] init failed', e);
    }
  });
}
