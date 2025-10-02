export function mountOverlay({bus,store}){
  const el=document.getElementById('overlay');
  const t=document.getElementById('ov-t');
  const b=document.getElementById('ov-b');
  const i=document.getElementById('ov-i');

  async function resolveImageIfNeeded(caption){
    try{
      const hasBlob = typeof caption.img==='string' && caption.img.startsWith('blob:');
      const missing = !caption.img || hasBlob;
      if(missing && caption.imageId && window.gapi?.client){
        // Re-download from Drive and create a fresh object URL
        const mod = await import('../app/drive_images.js');
        const blob = await mod.downloadBlob(caption.imageId);
        const url = URL.createObjectURL(blob);
        caption.img = url; // mutate for this session
        return url;
      }
    }catch(e){
      console.warn('[overlay] resolveImageIfNeeded failed', e);
    }
    return caption.img || '';
  }

  function _showSync(c){
    t.textContent=c.title||'';
    b.textContent=c.body||'';
  }

  async function show(c){
    _showSync(c);
    const url = await resolveImageIfNeeded(c);
    if(url){
      i.src=url; i.style.display='block';
    }else{
      i.style.display='none';
    }
    el.style.display='block';
  }
  function hide(){ el.style.display='none'; }

  bus.on('pin:selected',(id)=>{
    if(!id){ hide(); return; }
    const p=store.state.pins.find(p=>p.id===id);
    if(!p){ hide(); return; }
    show(p.caption||{});
  });
  bus.on('overlay:show', show);
  bus.on('overlay:hide', hide);
}