// features/overlay.js
// Minimal caption overlay. Exposes window.__LMY_overlay.{showOverlay,hideOverlay}
(function(){
  const ID = 'lmy-overlay';
  function ensureStyle(){
    if(document.getElementById(ID+'-css')) return;
    const css = `
    #${ID}{
      position:fixed; right:16px; bottom:16px; width:min(360px, 48vw);
      max-height:50vh; overflow:auto; z-index:2147482000;
      background:#111; color:#eee; border-radius:12px; box-shadow:0 6px 30px rgba(0,0,0,.4);
      border:1px solid rgba(255,255,255,.08); padding:12px; display:none;
      font-family: system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
    }
    #${ID}.open{ display:block; }
    #${ID} h3{ margin:.2rem 0 .4rem; font-size:16px; line-height:1.3 }
    #${ID} p{ margin:0 0 .4rem; font-size:13px; opacity:.9 }
    #${ID} img{ width:100%; height:auto; border-radius:8px; display:block; margin-top:.25rem; background:#000; }
    #${ID} .small{ font-size:12px; opacity:.7 }
    `;
    const s = document.createElement('style'); s.id=ID+'-css'; s.textContent = css; document.head.appendChild(s);
  }
  function ensureBox(){
    let box = document.getElementById(ID);
    if(!box){
      box = document.createElement('div'); box.id = ID;
      box.innerHTML = `<div class="small" id="${ID}-meta"></div>
        <h3 id="${ID}-title"></h3>
        <p id="${ID}-body"></p>
        <img id="${ID}-img" alt="" />`;
      document.body.appendChild(box);
    }
    return box;
  }
  async function showOverlay({ title='', body='', imgUrl=null, meta='' }={}){
    ensureStyle();
    const box = ensureBox();
    box.querySelector('#'+ID+'-title').textContent = title || '';
    box.querySelector('#'+ID+'-body').textContent = body || '';
    box.querySelector('#'+ID+'-meta').textContent = meta || '';
    const img = box.querySelector('#'+ID+'-img');
    if(imgUrl){ img.src = imgUrl; img.style.display='block'; } else { img.removeAttribute('src'); img.style.display='none'; }
    box.classList.add('open');
  }
  function hideOverlay(){
    const box = document.getElementById(ID);
    if(box) box.classList.remove('open');
  }
  // Custom event wiring (optional)
  document.addEventListener('lmy:select-pin', (e)=>{
    const c = e.detail || {}; showOverlay({ title:c.title, body:c.body, imgUrl:c.imgUrl, meta:c.meta });
  });
  document.addEventListener('lmy:deselect-pin', hideOverlay);

  window.__LMY_overlay = { showOverlay, hideOverlay };
})();
