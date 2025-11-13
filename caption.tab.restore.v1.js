
// caption.tab.restore.v1.js — Phase A1: resurrect Caption tab UI + minimal wiring
(() => {
  const log = (...a) => console.log('[cap-tab vA1]', ...a);

  // --- Discover target tab root ------------------------------------------------
  function ensureTabRoot(){
    // Prefer existing caption panel if present
    let root = document.querySelector('#panel-caption');
    if (!root){
      // Fallback: create a section next to material panel
      const panelAnchor = document.querySelector('#panel-material') || document.body;
      root = document.createElement('section');
      root.id = 'panel-caption';
      root.className = 'lm-panel-caption card';
      root.style.marginTop = '8px';
      panelAnchor.parentNode.insertBefore(root, panelAnchor); // before material
    }
    return root;
  }

  // --- Bridge discovery --------------------------------------------------------
  function findBridge(){
    const keys = ['addPinMarker','removePinMarker','setPinSelected','onPinSelect','onCanvasShiftPick'];
    for (const k in window){
      const v = window[k];
      if (v && typeof v === 'object' && keys.every(x => x in v)){
        return v;
      }
    }
    return null;
  }

  // --- State -------------------------------------------------------------------
  const state = {
    currentColor: '#e6b35a', // default like the left-most pill
    filter: new Set(),       // empty = show all
    items: [],               // {id,title,body,color,imageId,position}
    selectedId: null,
  };

  // util
  const uid = () => 'cap-' + Math.random().toString(36).slice(2,8);

  // --- Render ------------------------------------------------------------------
  function render(root, bridge){
    root.classList.add('lm-cap');
    root.innerHTML = `
      <div class="tabs small muted" style="margin-bottom:4px;">Caption</div>

      <div class="row">
        <div class="header">Pin color</div>
        <div class="colors"></div>
      </div>

      <div class="row">
        <div class="header">Filter</div>
        <div class="filters"></div>
      </div>

      <div class="row">
        <div class="header">Caption list</div>
        <div class="list" aria-label="Caption list"></div>
      </div>

      <div class="row">
        <div class="header">Title / Body</div>
        <input type="text" class="title" placeholder="Title"/>
        <div style="height:6px;"></div>
        <textarea class="body" placeholder="Body"></textarea>
      </div>

      <div class="row">
        <div class="header">No Image</div>
        <div class="muted">Images (auto from GLB folder) — <span title="Will be reconnected in Phase A2">coming soon</span></div>
        <div class="grid images"></div>
      </div>

      <div class="row muted warn" style="display:none;">Viewer bridge not found — UI is in demo mode.</div>
    `;

    // Colors
    const palette = ['#e6b35a','#cfe265','#9db3ff','#b6a0ff','#b3e0ff','#dcb3c7','#c8bdb3','#9aa3aa'];
    const colors = root.querySelector('.colors');
    palette.forEach(col => {
      const el = document.createElement('div');
      el.className = 'pill';
      el.style.background = col;
      el.title = col;
      if (col === state.currentColor) el.classList.add('active');
      el.addEventListener('click', () => {
        state.currentColor = col;
        colors.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p===el));
      });
      colors.appendChild(el);
    });

    // Filters (All / None + same palette)
    const filters = root.querySelector('.filters');
    const mkBtn = (label, on) => {
      const b = document.createElement('div');
      b.className = 'pill';
      b.textContent = label;
      b.addEventListener('click', on);
      return b;
    };
    filters.appendChild(mkBtn('All', () => { state.filter.clear(); redrawList(root); }));
    filters.appendChild(mkBtn('None', () => {
      state.filter = new Set(palette); redrawList(root);
    }));
    palette.forEach(col => {
      const el = document.createElement('div');
      el.className = 'pill';
      el.style.background = col;
      el.title = 'toggle filter';
      el.addEventListener('click', () => {
        if (state.filter.has(col)) state.filter.delete(col); else state.filter.add(col);
        el.classList.toggle('active', state.filter.has(col));
        redrawList(root);
      });
      filters.appendChild(el);
    });

    // Inputs
    const title = root.querySelector('.title');
    const body  = root.querySelector('.body');
    title.addEventListener('input', () => {
      const it = state.items.find(i => i.id === state.selectedId);
      if (it){ it.title = title.value; if (bridge && typeof bridge.setPinSelected==='function') bridge.setPinSelected({ id: it.id }); redrawList(root); }
    });
    body.addEventListener('input', () => {
      const it = state.items.find(i => i.id === state.selectedId);
      if (it){ it.body = body.value; if (bridge && typeof bridge.setPinSelected==='function') bridge.setPinSelected({ id: it.id }); }
    });

    // Warn if no bridge
    if (!bridge) root.querySelector('.warn').style.display = '';

    redrawList(root);
  }

  function redrawList(root){
    const list = root.querySelector('.list');
    list.innerHTML = '';
    const visible = state.items.filter(it => !state.filter.size || !state.filter.has(it.color));
    visible.forEach(it => {
      const row = document.createElement('div');
      row.className = 'item' + (it.id===state.selectedId ? ' active':'');
      row.innerHTML = `
        <div class="del" title="Delete">×</div>
        <div style="font-weight:600;">${it.title || '(untitled)'}</div>
        <div class="muted">${it.body ? it.body.slice(0,100) : '(no description)'}</div>
      `;
      row.addEventListener('click', (e) => {
        const tgt = e.target;
        if (tgt && tgt.classList && tgt.classList.contains('del')) return;
        select(it.id, root);
      });
      row.querySelector('.del').addEventListener('click', () => {
        remove(it.id, root);
      });
      list.appendChild(row);
    });
  }

  function select(id, root){
    state.selectedId = id;
    redrawList(root);
    const it = state.items.find(i => i.id===id);
    if (it){
      root.querySelector('.title').value = it.title || '';
      root.querySelector('.body').value  = it.body  || '';
    }
  }

  function remove(id, root){
    const idx = state.items.findIndex(i => i.id===id);
    if (idx>=0){
      const [it] = state.items.splice(idx,1);
      if (window.__LM_BRIDGE && window.__LM_BRIDGE.removePinMarker) {
        try{ window.__LM_BRIDGE.removePinMarker({ id: it.id }); }catch{}
      }
      if (state.selectedId===id) state.selectedId=null;
      redrawList(root);
    }
  }

  function addItemFromPick(point, bridge, root){
    const item = {
      id: uid(),
      title: '',
      body: '',
      color: state.currentColor,
      imageId: null,
      position: point || [0,0,0],
    };
    state.items.push(item);
    // push to 3D
    if (bridge){
      try{
        bridge.addPinMarker({
          id: item.id,
          position: item.position,
          color: item.color,
          title: item.title,
          body: item.body,
        });
      }catch(e){ log('bridge add failed', e); }
    }
    select(item.id, root);
  }

  // --- Boot --------------------------------------------------------------------
  function boot(){
    const root = ensureTabRoot();
    const bridge = findBridge();
    window.__LM_BRIDGE = bridge; // expose for debugging
    render(root, bridge);

    if (bridge){
      // Sync select -> list
      try{ bridge.onPinSelect(({ id }) => { if (id) select(id, root); }); }catch{}
      // Shift+click to create
      try{ bridge.onCanvasShiftPick(({ point }) => addItemFromPick(point, bridge, root)); }catch{}
    }
    log('ready', { hasBridge: !!bridge });
  }

  // Run after DOM ready
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', boot, { once:true });
  } else {
    boot();
  }
})();
