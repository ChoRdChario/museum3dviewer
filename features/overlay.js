export function mountOverlay({bus,store}){
  const el=document.getElementById('overlay');
  const t=document.getElementById('ov-t');
  const b=document.getElementById('ov-b');
  const i=document.getElementById('ov-i');

  let revokePrev = null;

  async function resolveImageIfNeeded(caption){
    try{
      if (caption.img && typeof caption.img==='string' && !caption.img.startsWith('blob:')) return caption.img;
      if (caption.imageId && window.gapi?.client){
        const { getFileMeta, downloadBlob, ensureHeic2Any } = await import('../app/drive_images.js');
        const meta = await getFileMeta(caption.imageId);
        const blob = await downloadBlob(caption.imageId);
        let outUrl='';
        if (/heic|heif/i.test(meta?.mimeType||'')) {
          try{
            await ensureHeic2Any();
            const jpeg = await window.heic2any({ blob, toType:'image/jpeg', quality:0.9 });
            outUrl = URL.createObjectURL(jpeg);
          }catch(convErr){
            console.warn('[overlay] HEIC convert failed, fallback to thumbnail', convErr);
            outUrl = meta?.thumbnailLink || '';
          }
        }else{
          outUrl = URL.createObjectURL(blob);
        }
        if (revokePrev){ try{ URL.revokeObjectURL(revokePrev); }catch(_){} }
        if (outUrl && outUrl.startsWith('blob:')) revokePrev = outUrl;
        caption.img = outUrl;
        caption.imageMime = meta?.mimeType;
        caption.thumbnailLink = meta?.thumbnailLink || caption.thumbnailLink;
        return outUrl;
      }
    }catch(e){
      console.warn('[overlay] resolveImageIfNeeded', e);
    }
    return caption.thumbnailLink || caption.img || '';
  }

  function _showSync(c){ t.textContent=c.title||''; b.textContent=c.body||''; }

  async function show(c){
    _showSync(c);
    const url = await resolveImageIfNeeded(c);
    if(url){ i.src=url; i.style.display='block'; } else { i.style.display='none'; }
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