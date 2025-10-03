// features/ui_shims.js
(function(){
  const side = document.getElementById('side');
  if(!side) return;

  // ----- Images grid -----
  let imagesSection = document.getElementById('lmy-images-sec');
  if(!imagesSection){
    imagesSection = document.createElement('section');
    imagesSection.id = 'lmy-images-sec';
    imagesSection.innerHTML = `
      <h4 style="margin:.5rem 0 .25rem">Images</h4>
      <div id="lmy-images-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;"></div>
    `;
    side.appendChild(imagesSection);
  }

  if(!window.__LMY_renderImageGrid){
    window.__LMY_renderImageGrid = function(images){
      const grid = document.getElementById('lmy-images-grid');
      if(!grid) return;
      grid.innerHTML = '';
      (images||[]).forEach(file=>{
        const btn = document.createElement('button');
        btn.type='button';
        btn.title = file.name;
        Object.assign(btn.style,{
          width:'100%', aspectRatio:'1 / 1', border:'1px solid #222', borderRadius:'8px',
          background:'#0f0f10', padding:0, overflow:'hidden', cursor:'pointer'
        });
        const img = document.createElement('img');
        img.loading='lazy';
        img.src = (file.thumbnailLink || '').replace(/=s\d+/, '=s256');
        img.alt = file.name || '';
        img.style.width='100%';
        img.style.height='100%';
        img.style.objectFit='cover';
        btn.appendChild(img);
        btn.onclick = () => document.dispatchEvent(new CustomEvent('lmy:image-picked',{ detail: file }));
        grid.appendChild(btn);
      });
    };
  }

  // ----- Overlay -----
  let overlaySec = document.getElementById('lmy-overlay-sec');
  if(!overlaySec){
    overlaySec = document.createElement('section');
    overlaySec.id = 'lmy-overlay-sec';
    overlaySec.innerHTML = `
      <h4 style="margin:.75rem 0 .25rem">Caption</h4>
      <div id="lmy-overlay" style="display:flex;flex-direction:column;gap:6px;">
        <input id="lmy-cap-title" placeholder="Title" style="background:#0f0f10;border:1px solid #222;border-radius:8px;color:#ddd;padding:6px 8px" />
        <textarea id="lmy-cap-body" placeholder="Body" rows="4" style="background:#0f0f10;border:1px solid #222;border-radius:8px;color:#ddd;padding:6px 8px;resize:vertical"></textarea>
        <img id="lmy-cap-img" style="width:100%;border:1px solid #222;border-radius:8px;display:none" alt="preview"/>
      </div>
    `;
    side.appendChild(overlaySec);
  }

  function showOverlay({title='', body='', imgUrl=''}){
    const t = document.getElementById('lmy-cap-title');
    const b = document.getElementById('lmy-cap-body');
    const img = document.getElementById('lmy-cap-img');
    if(t) t.value = title;
    if(b) b.value = body;
    if(img){
      if(imgUrl){ img.src = imgUrl; img.style.display = 'block'; }
      else { img.removeAttribute('src'); img.style.display='none'; }
    }
  }
  function hideOverlay(){ showOverlay({ title:'', body:'', imgUrl:'' }); }

  if(!window.__LMY_overlay){ window.__LMY_overlay = { showOverlay, hideOverlay }; }

  // Inputs → update event
  const t = document.getElementById('lmy-cap-title');
  const b = document.getElementById('lmy-cap-body');
  const emitUpdate = () => document.dispatchEvent(new CustomEvent('lmy:update-caption', {
    detail: { id: window.__LMY_selectedPinId, title: t?.value || '', body: b?.value || '' }
  }));
  [t,b].forEach(el => el && el.addEventListener('input', emitUpdate));

  // Allow pin selection id to flow in (optional)
  document.addEventListener('lmy:pin-selected-id', (e)=>{ window.__LMY_selectedPinId = e.detail?.id || null; });
})();
