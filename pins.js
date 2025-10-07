// pins.js — Caption pins: 3D markers, selection, overlay & list binding
// Requirements: a viewer from viewer.js (THREE, scene, camera, renderer, controls)
// DOM: #capList container exists; we won't change layout, only append children within it.

export class PinManager{
  constructor(viewer, {viewerWrapEl, capListEl}){
    this.v = viewer;
    this.THREE = viewer.THREE;
    this.scene = viewer.scene;
    this.camera = viewer.camera;
    this.renderer = viewer.renderer;

    this.viewerWrapEl = viewerWrapEl;
    this.capListEl = capListEl;

    this.raycaster = new this.THREE.Raycaster();
    this.pointer = new this.THREE.Vector2();
    this.placing = false;

    this.pins = []; // {id, pos:THREE.Vector3, title, body, imageUrl, mesh, dom?, lineSvg?, listRow}
    this.selectedId = null;

    // overlay DOMs (singletons, re-used for selected pin)
    this._ensureOverlay();

    // canvas events
    this._boundOnCanvasClick = (e)=>this._onCanvasClick(e);
    this.renderer.domElement.addEventListener('click', this._boundOnCanvasClick);

    // rerender overlay each frame
    const loop = ()=>{ this._updateOverlay(); requestAnimationFrame(loop); };
    loop();
  }

  dispose(){
    this.renderer.domElement.removeEventListener('click', this._boundOnCanvasClick);
    this._removeOverlay();
  }

  _ensureOverlay(){
    // SVG line (leader line)
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS,'svg');
    svg.setAttribute('class','pin-line-layer');
    svg.style.position = 'absolute';
    svg.style.inset = '0';
    svg.style.pointerEvents = 'none';
    svg.style.display = 'none';
    const line = document.createElementNS(svgNS,'line');
    line.setAttribute('stroke','#8fb1ff');
    line.setAttribute('stroke-width','2');
    line.setAttribute('x1','0');line.setAttribute('y1','0');line.setAttribute('x2','0');line.setAttribute('y2','0');
    svg.appendChild(line);

    // floating caption bubble
    const bubble = document.createElement('div');
    bubble.className = 'pin-bubble';
    Object.assign(bubble.style, {
      position:'absolute', minWidth:'160px', maxWidth:'280px',
      background:'#0e111a', color:'#e7e9ee', border:'1px solid #2b3550',
      borderRadius:'10px', padding:'8px 10px', boxShadow:'0 8px 20px rgba(0,0,0,0.35)',
      display:'none', pointerEvents:'auto'
    });
    bubble.innerHTML = `
      <div class="pin-bubble-title" style="font-weight:600;margin-bottom:4px;"></div>
      <div class="pin-bubble-body" style="font-size:12px;opacity:.9;margin-bottom:6px;"></div>
      <a class="pin-bubble-imglink" href="#" target="_blank" style="font-size:12px;word-break:break-all;"></a>
    `;

    this.viewerWrapEl.appendChild(svg);
    this.viewerWrapEl.appendChild(bubble);
    this.lineSvg = svg;
    this.lineEl = line;
    this.bubbleEl = bubble;
  }

  _removeOverlay(){
    if (this.lineSvg?.parentNode) this.lineSvg.parentNode.removeChild(this.lineSvg);
    if (this.bubbleEl?.parentNode) this.bubbleEl.parentNode.removeChild(this.bubbleEl);
    this.lineSvg = this.lineEl = this.bubbleEl = null;
  }

  startPlacing(){
    this.placing = true;
    // UI側でボタンの見た目は変更しないが、カーソルでフィードバック
    this.renderer.domElement.style.cursor = 'crosshair';
  }
  stopPlacing(){
    this.placing = false;
    this.renderer.domElement.style.cursor = '';
  }

  addPinAt(position){
    const id = crypto.randomUUID ? crypto.randomUUID() : ('pin_'+Date.now()+'_'+Math.random().toString(36).slice(2,7));
    const sphere = new this.THREE.Mesh(
      new this.THREE.SphereGeometry(0.01, 16, 16),
      new this.THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0x331a00 })
    );
    sphere.position.copy(position);
    sphere.userData.pinId = id;
    this.scene.add(sphere);

    const rec = { id, pos: position.clone(), title:'', body:'', imageUrl:'', mesh: sphere, listRow:null };
    this.pins.push(rec);
    this._appendListRow(rec);
    this.select(id);
    return rec;
  }

  delete(id){
    const idx = this.pins.findIndex(p=>p.id===id);
    if (idx<0) return;
    const rec = this.pins[idx];
    if (rec.mesh?.parent) rec.mesh.parent.remove(rec.mesh);
    if (rec.listRow?.parentNode) rec.listRow.parentNode.removeChild(rec.listRow);
    if (this.selectedId===id) this.selectedId = null;
    this.pins.splice(idx,1);
    this._hideOverlay();
  }

  select(id){
    this.selectedId = id;
    // highlight
    this.pins.forEach(p=>{
      if (!p.mesh) return;
      p.mesh.material.color.setHex(p.id===id ? 0x00d8ff : 0xffaa00);
      p.mesh.material.emissive.setHex(p.id===id ? 0x003344 : 0x331a00);
    });
    this._updateOverlay(true);
    // list row highlight
    this.pins.forEach(p=> p.listRow?.classList.toggle('active', p.id===id));
  }

  _appendListRow(rec){
    const row = document.createElement('div');
    row.className = 'cap-row';
    row.style.display = 'grid';
    row.style.gridTemplateColumns = '1fr auto';
    row.style.gap = '6px';
    row.style.alignItems = 'start';
    row.style.padding = '6px';
    row.style.margin = '6px 0';
    row.style.border = '1px solid #21273a';
    row.style.borderRadius = '8px';
    row.style.background = '#10131a';

    const left = document.createElement('div');
    left.innerHTML = `
      <input class="cap-title" type="text" placeholder="タイトル" style="width:100%;margin-bottom:4px;padding:6px 8px;border-radius:8px;border:1px solid #2a3144;background:#0e111a;color:#e8ecf5">
      <textarea class="cap-body" placeholder="本文" rows="2" style="width:100%;padding:6px 8px;border-radius:8px;border:1px solid #2a3144;background:#0e111a;color:#e8ecf5;resize:vertical"></textarea>
      <input class="cap-img" type="text" placeholder="画像URL（任意）" style="width:100%;margin-top:4px;padding:6px 8px;border-radius:8px;border:1px solid #2a3144;background:#0e111a;color:#e8ecf5">
    `;
    const right = document.createElement('div');
    right.style.display = 'flex';
    right.style.flexDirection = 'column';
    right.style.gap = '6px';
    right.innerHTML = `
      <button class="cap-select">選択</button>
      <button class="cap-delete">削除</button>
    `;

    row.appendChild(left);
    row.appendChild(right);
    this.capListEl.appendChild(row);
    rec.listRow = row;

    const titleEl = row.querySelector('.cap-title');
    const bodyEl  = row.querySelector('.cap-body');
    const imgEl   = row.querySelector('.cap-img');
    const selBtn  = row.querySelector('.cap-select');
    const delBtn  = row.querySelector('.cap-delete');

    const syncBubble = ()=>{
      rec.title = titleEl.value;
      rec.body = bodyEl.value;
      rec.imageUrl = imgEl.value;
      if (this.selectedId===rec.id) this._updateOverlay(true);
    };
    titleEl.addEventListener('input', syncBubble);
    bodyEl.addEventListener('input', syncBubble);
    imgEl.addEventListener('input', syncBubble);

    selBtn.addEventListener('click', ()=> this.select(rec.id));
    delBtn.addEventListener('click', ()=> this.delete(rec.id));

    row.addEventListener('click', ()=> this.select(rec.id));
  }

  _onCanvasClick(e){
    const rect = this.renderer.domElement.getBoundingClientRect();
    const x = ( (e.clientX - rect.left) / rect.width ) * 2 - 1;
    const y = -( (e.clientY - rect.top) / rect.height ) * 2 + 1;
    this.pointer.set(x, y);
    this.raycaster.setFromCamera(this.pointer, this.camera);

    // If placing, intersect with model
    if (this.placing){
      const hits = this._intersectVisible();
      if (hits.length>0){
        const pt = hits[0].point;
        this.addPinAt(pt);
        this.stopPlacing();
        return;
      }
      return;
    }

    // If not placing, select pin if clicked
    const pinHit = this._intersectPins();
    if (pinHit){
      this.select(pinHit.userData.pinId);
      return;
    }
  }

  _intersectVisible(){
    const objs = [];
    this.scene.traverse(o=>{ if (o.isMesh && o.visible) objs.push(o); });
    // exclude our pin meshes:
    const filtered = objs.filter(o=> !o.userData.pinId);
    return this.raycaster.intersectObjects(filtered, true);
  }
  _intersectPins(){
    const pins = this.pins.map(p=>p.mesh).filter(Boolean);
    const hits = this.raycaster.intersectObjects(pins, true);
    return hits[0]?.object || null;
  }

  _updateOverlay(force=false){
    if (!this.selectedId){ this._hideOverlay(); return; }
    const rec = this.pins.find(p=>p.id===this.selectedId);
    if (!rec){ this._hideOverlay(); return; }

    const canvas = this.renderer.domElement;
    const rect = canvas.getBoundingClientRect();

    // project 3D -> 2D
    const p = rec.pos.clone().project(this.camera);
    const sx = (p.x * 0.5 + 0.5) * rect.width;
    const sy = (-p.y * 0.5 + 0.5) * rect.height;

    // line: from pin screen pos to bubble corner
    this.lineSvg.style.display = '';
    this.lineSvg.setAttribute('width', rect.width);
    this.lineSvg.setAttribute('height', rect.height);
    const bx = Math.min(rect.width - 10, Math.max(10, sx + 80));
    const by = Math.min(rect.height - 10, Math.max(10, sy - 40));
    this.lineEl.setAttribute('x1', String(sx));
    this.lineEl.setAttribute('y1', String(sy));
    this.lineEl.setAttribute('x2', String(bx));
    this.lineEl.setAttribute('y2', String(by));

    // bubble
    const title = rec.title || '（無題）';
    const body  = rec.body  || '';
    const link  = rec.imageUrl || '';
    this.bubbleEl.querySelector('.pin-bubble-title').textContent = title;
    this.bubbleEl.querySelector('.pin-bubble-body').textContent = body;
    const a = this.bubbleEl.querySelector('.pin-bubble-imglink');
    a.textContent = link ? link : '';
    a.href = link || '#';
    this.bubbleEl.style.display = '';
    this.bubbleEl.style.left = (bx + rect.left) + 'px';
    this.bubbleEl.style.top  = (by + rect.top) + 'px';
  }

  _hideOverlay(){
    if (this.lineSvg) this.lineSvg.style.display = 'none';
    if (this.bubbleEl) this.bubbleEl.style.display = 'none';
  }

  toJSON(){
    return this.pins.map(p=>({
      id: p.id,
      position: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
      title: p.title || '',
      body:  p.body || '',
      imageUrl: p.imageUrl || '',
    }));
  }
}
