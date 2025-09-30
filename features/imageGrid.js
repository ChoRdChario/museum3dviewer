export function mountGrid({ bus, store }){
  const wrap = document.getElementById('grid');
  const g = wrap.querySelector('.g');
  let open = false;
  let toJpegUrlIfNeeded = null;

  function render(){
    g.innerHTML = '';
    (store.state.images||[]).forEach(file=>{
      const btn = document.createElement('button');
      btn.style.border='none'; btn.style.background='transparent'; btn.style.padding='0'; btn.style.cursor='pointer';
      const img = document.createElement('img'); img.src = file.thumbnailLink; img.alt = file.name||'';
      btn.appendChild(img);
      btn.addEventListener('click', async ()=>{
        const sel = store.state.selected;
        if (!sel) return;
        const pin = store.state.pins.find(p=>p.id===sel);
        if (!pin) return;
        try{
          if (!toJpegUrlIfNeeded) {
            const mod = await import('../app/drive_images.js');
            toJpegUrlIfNeeded = mod.toJpegUrlIfNeeded;
          }
          const url = await toJpegUrlIfNeeded(file);
          pin.caption.img = url;
          bus.emit('overlay:show', pin.caption);
        }catch(e){
          console.warn('[grid] convert/select failed', e);
          pin.caption.img = file.thumbnailLink;
          bus.emit('overlay:show', pin.caption);
        }
      });
      g.appendChild(btn);
    });
  }
  bus.on('images:update', (list)=>{ store.set({images:list}); render(); });
  bus.on('grid:toggle', ()=>{ open=!open; wrap.style.display = open ? 'block':'none'; });
}