/* glb.btn.bridge.v3.js — ensure viewer with defaults, then load via loadGlbFromDrive */
(function(){
  const TAG='[glb-bridge-v3]';
  const log=(...a)=>console.log(TAG, ...a);
  const err=(...a)=>console.error(TAG, ...a);

  function extractId(input){
    if (!input) return '';
    if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
    try{
      const u = new URL(input);
      const m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if (m) return m[1];
      const qp = u.searchParams.get('id');
      if (qp) return qp;
    }catch(_){}
    return '';
  }

  function ensureCanvas(){
    let canvas = document.querySelector("#viewer-canvas") || document.querySelector("canvas");
    if (canvas) return canvas;
    let container = document.querySelector("#viewer") || document.querySelector("#three-container") || document.querySelector(".viewer") || document.body;
    canvas = document.createElement("canvas");
    canvas.id = "viewer-canvas";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    canvas.style.display = "block";
    if (container === document.body){
      const wrapper = document.createElement("div");
      wrapper.id = "viewer-wrapper";
      wrapper.style.position = "relative";
      wrapper.style.width = "100%";
      wrapper.style.height = "70vh";
      wrapper.style.margin = "8px 0";
      wrapper.appendChild(canvas);
      document.body.prepend(wrapper);
    } else {
      container.prepend(canvas);
    }
    return canvas;
  }

  async function getToken(){
    if (typeof window.__lm_getAccessToken === 'function'){
      return await window.__lm_getAccessToken();
    }
    try{
      const g = await import('./gauth.module.js');
      if (g.getAccessToken) return await g.getAccessToken();
    }catch(_){}
    throw new Error('no token provider');
  }

  async function ensureViewerReady(mod){
    try{
      if (typeof mod.ensureViewer === 'function'){
        const canvas = ensureCanvas();
        log('calling ensureViewer with canvas', canvas.id || '(anon)');
        await mod.ensureViewer({ canvas, container: canvas.parentElement || document.body });
      }
    }catch(e){ err('ensureViewer(opts) failed', e); }

    const cands = ['bootViewer','initViewer','setupViewer','mountViewer','createViewer','startViewer','init'];
    for (const name of cands){
      try{
        if (typeof mod[name] === 'function'){
          log('calling', name);
          await mod[name]();
          break;
        }
      }catch(e){ err(name+' failed', e); }
    }

    const ready = await new Promise(res=>{
      let done=false;
      const ok=()=>{ if(done) return; done=true; res(true); };
      const t = setTimeout(()=>{ if(!done) res(!!document.querySelector('canvas')); }, 3000);
      window.addEventListener('lm:scene-ready', ok, { once:true });
      window.addEventListener('lm:model-ready', ok, { once:true });
      if (document.querySelector('canvas')) setTimeout(ok, 50);
    });
    log('viewer ready?', ready);
    return true;
  }

  async function loadById(fileId){
    const mod = await import('./viewer.module.cdn.js');
    try{ console.log(TAG, 'exports:', Object.keys(mod)); }catch(_){}
    await ensureViewerReady(mod);
    const token = await getToken();
    try{
      await mod.loadGlbFromDrive(fileId, { token });
    }catch(e){
      err('loadGlbFromDrive threw', e);
      throw e;
    }
  }

  function wireBtn(){
    const btn = document.querySelector('#btnGlb');
    if (!btn) return;
    if (btn.dataset && btn.dataset.glbBridgeWiredV3) return;
    btn.dataset.glbBridgeWiredV3 = '1';
    btn.addEventListener('click', async ()=>{
      try{
        const input = document.querySelector('#glbUrl');
        let raw = input && input.value ? input.value.trim() : '';
        if (!raw) raw = prompt('Driveの共有URL または fileId を入力してください') || '';
        const id = extractId(raw);
        if (!id){ log('no id'); return; }
        log('load fileId', id);
        await loadById(id);
      }catch(e){ err('btn load failed', e); }
    }, { passive:true });
    log('button wired v3');
  }

  function wireEvent(){
    window.addEventListener('lm:load-glb', async (ev)=>{
      try{
        const id = ev && ev.detail && ev.detail.id;
        if (!id) return;
        log('event load fileId', id);
        await loadById(id);
      }catch(e){ err('event load failed', e); }
    });
    log('event listener armed');
  }

  window.__LM_LOAD_GLB_BY_ID = loadById;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ wireBtn(); wireEvent(); }, { once:true });
  } else {
    wireBtn(); wireEvent();
  }
})();