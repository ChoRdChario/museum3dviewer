export function setupPins(app){
  const overlay = document.getElementById('overlay');
  const titleInput = document.getElementById('capTitle');
  const bodyInput  = document.getElementById('capBody');
  const btnAdd = document.getElementById('btnAddPin');
  const btnClear = document.getElementById('btnClearPins');

  const pins = []; // {obj, line, title, body, hit}

  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${title??''}</strong><div style="margin-top:.25rem">${body??''}</div>${imgUrl?`<img src="${imgUrl}">`:''}`;
  }
  function hideOverlay(){ overlay.style.display='none'; }

  function selectPin(p){
    pins.forEach(pp=>{ if (pp.line) pp.line.visible = false; });
    if (!p) { hideOverlay(); return; }
    if (p.line) p.line.visible = true;
    showOverlay({ title: p.title||'(untitled)', body: p.body||'' });
  }

  function addPinAt(hit){
    const THREE = app.viewer.THREE;
    const pin = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffcc55 })
    );
    pin.position.copy(hit.point);
    app.viewer.scene.add(pin);

    // leader line to camera target
    const points = [ pin.position, app.viewer.controls.target.clone() ];
    const geom = new THREE.BufferGeometry().setFromPoints(points);
    const mat = new THREE.LineBasicMaterial({ color: 0xffcc55 });
    const line = new THREE.Line(geom, mat);
    line.visible = false;
    app.viewer.scene.add(line);

    const rec = { obj: pin, line, title: titleInput.value, body: bodyInput.value, hit };
    pins.push(rec);
    selectPin(rec);
  }

  // Shift+click to add
  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (!e.shiftKey) return;
    const hit = app.viewer.raycastFromClientXY(e.clientX, e.clientY);
    if (hit) addPinAt(hit);
  });

  // Click to select nearest pin (within small screen-space radius)
  app.viewer.renderer.domElement.addEventListener('click', (e)=>{
    if (e.shiftKey) return; // handled above
    if (!pins.length) return;
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
    if (Math.sqrt(bestD2) < 24) selectPin(best); // 24px以内を選択
  });

  btnAdd.addEventListener('click', ()=>{
    // helper: add at screen center ray
    const rect = app.viewer.renderer.domElement.getBoundingClientRect();
    const cx = rect.left + rect.width/2, cy = rect.top + rect.height/2;
    const hit = app.viewer.raycastFromClientXY(cx, cy);
    if (hit) addPinAt(hit);
  });

  btnClear.addEventListener('click', ()=>{
    pins.forEach(p=>{
      app.viewer.scene.remove(p.obj);
      app.viewer.scene.remove(p.line);
    });
    pins.length = 0;
    hideOverlay();
  });
}
