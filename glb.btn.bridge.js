/* glb.btn.bridge.v2.js — ensure viewer initialized, then load via loadGlbFromDrive */
(function(){
  const TAG='[glb-bridge-v2]';
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
    // Try common init function names
    const cands = ['bootViewer','initViewer','setupViewer','mountViewer','createViewer','ensureViewer','startViewer','init'];
    for (const name of cands){
      try{
        if (typeof mod[name] === 'function'){
          log('calling', name);
          const r = await mod[name]();
          // allow microtask flush
          await new Promise(r=>setTimeout(r,0));
          break;
        }
      }catch(e){ err(name+' failed', e); }
    }
    // Also wait for lm:scene-ready if emitted by other modules
    const ready = await new Promise(res=>{
      let t = setTimeout(()=>res(false), 1500);
      function ok(){ clearTimeout(t); res(true); }
      window.addEventListener('lm:scene-ready', ok, { once:true });
      // if already ready, resolve quickly
      if (document.querySelector('canvas') && window.THREE) { setTimeout(ok, 50); }
    });
    log('viewer ready?', ready);
    return true;
  }

  async function loadById(fileId){
    const mod = await import('./viewer.module.cdn.js');
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
    if (btn.dataset && btn.dataset.glbBridgeWiredV2) return;
    btn.dataset.glbBridgeWiredV2 = '1';
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
    log('button wired v2');
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

  // expose for console
  window.__LM_LOAD_GLB_BY_ID = loadById;

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ wireBtn(); wireEvent(); }, { once:true });
  } else {
    wireBtn(); wireEvent();
  }
})();