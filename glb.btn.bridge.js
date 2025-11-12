/* glb.btn.bridge.js — load via viewer.module.cdn.js (Drive fileId)
 * This wires #btnGlb and listens to lm:load-glb to call loadGlbFromDrive(fileId,{token}).
 */
(function(){
  const TAG='[glb-bridge]';
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
    // fallback: gauth facade if present
    try{
      const g = await import('./gauth.module.js');
      if (g.getAccessToken) return await g.getAccessToken();
    }catch(_){}
    throw new Error('no token provider');
  }

  async function loadById(fileId){
    const mod = await import('./viewer.module.cdn.js');
    const token = await getToken();
    await mod.loadGlbFromDrive(fileId, { token });
  }

  function wireBtn(){
    const btn = document.querySelector('#btnGlb');
    if (!btn) return;
    if (btn.dataset && btn.dataset.glbBridgeWired) return;
    btn.dataset.glbBridgeWired = '1';
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
    log('button wired');
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