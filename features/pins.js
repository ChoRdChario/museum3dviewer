export function mountPins({ bus, store, viewer }){
  const pinMap = new Map();
  let idSeq = 0;

  function setSelected(id){
    store.set({ selected: id });
    bus.emit('pin:selected', id);
    // Update line visibility
    for (const [pid, rec] of pinMap){
      rec.lineVisible = (pid === id);
    }
  }

  // canvas handlers (single, capture)
  const canvas = viewer.canvas;
  canvas.addEventListener('click', (e)=>{
    if (e.shiftKey || e.altKey){
      const hit = viewer.raycastAt(0,0); // real app: use coords
      if (hit){
        const id = 'pin_'+(++idSeq);
        const pin = { id, x:hit.point.x, y:hit.point.y, z:hit.point.z, caption:{title:'新規キャプション', body:''} };
        store.state.pins.push(pin);
        pinMap.set(id, { lineVisible:true });
        setSelected(id);
        bus.emit('pin:added', pin);
      }
      return;
    }
    // select nearest (stub: select last)
    const last = store.state.pins.at(-1)?.id ?? null;
    setSelected(last);
  }, {capture:true});

  // public for overlay
  bus.on('caption:update', ({id, patch})=>{
    const p = store.state.pins.find(p=>p.id===id);
    if (!p) return;
    Object.assign(p.caption, patch);
    if (store.state.selected===id) bus.emit('overlay:show', p.caption);
  });
}