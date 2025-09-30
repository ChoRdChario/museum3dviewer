export function mountGrid({ bus, store }){
  const wrap = document.getElementById('grid');
  const g = wrap.querySelector('.g');
  let open = false;
  function render(){
    g.innerHTML = '';
    store.state.images.forEach(file=>{
      const btn = document.createElement('button');
      btn.style.border='none'; btn.style.background='transparent'; btn.style.padding='0'; btn.style.cursor='pointer';
      const img = document.createElement('img'); img.src = file.thumbnailLink; img.alt = file.name||'';
      btn.appendChild(img);
      btn.addEventListener('click', ()=>{
        const sel = store.state.selected;
        if (!sel) return;
        // attach to caption
        const pin = store.state.pins.find(p=>p.id===sel);
        if (!pin) return;
        pin.caption.img = file.thumbnailLink;
        bus.emit('overlay:show', pin.caption);
      });
      g.appendChild(btn);
    });
  }
  bus.on('images:update', (list)=>{ store.set({images:list}); render(); });
  bus.on('grid:toggle', ()=>{ open=!open; wrap.style.display = open ? 'block':'none'; });
}