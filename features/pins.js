export function mountPins({ bus, store, viewer }){
  const pinMap = new Map();
  let idSeq = 0;

  function setSelected(id){
    store.set({ selected: id });
    bus.emit('pin:selected', id);
    for (const [pid, rec] of pinMap){
      rec.lineVisible = (pid === id);
    }
  }

  const canvas = viewer.canvas;
  canvas.addEventListener('click', (e)=>{
    const hit = viewer.raycastAt(e.clientX, e.clientY);
    if (e.shiftKey || e.altKey){
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
    if (hit){
      let best=null, bestD=Infinity;
      for (const p of store.state.pins){
        const dx=p.x-hit.point.x, dy=p.y-hit.point.y, dz=p.z-hit.point.z;
        const d=Math.hypot(dx,dy,dz);
        if (d<bestD){bestD=d;best=p;}
      }
      setSelected(best?.id ?? null);
    }else{
      setSelected(null);
    }
  }, {capture:true});
}
