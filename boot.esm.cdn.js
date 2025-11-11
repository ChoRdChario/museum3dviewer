
/* LociMyu minimal boot + GLB resolver (safe stub)
 * Version: 2025-11-12T08:36Z
 * Scope: signin (GIS) + Drive(GLB)->blob + viewer hand-off
 * Globals exported: window.__LM_CLIENT_ID, window.__lm_getAccessToken, window.__lm_resolveAndLoadGLB
 */
(function(){
  const TAG = '[LM-boot.min]';

  // ----------------------------- small utils
  const log  = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);
  const err  = (...a)=>console.error(TAG, ...a);
  const qs   = (sel)=>document.querySelector(sel);

  // idempotent wire guard
  function once(el, key){ if(!el) return false; if(el[key]) return false; el[key]=true; return true; }

  // ----------------------------- client_id resolve (stable)
  function resolveClientId(){
    if (window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID;
    const pick = (...els)=>{
      for (const e of els){
        if (!e) continue;
        const c = e.getAttribute?.('content') || e.getAttribute?.('data-client_id') || e.getAttribute?.('data-lm-client-id');
        if (c) return c;
      }
      return null;
    };
    const m1 = document.querySelector('meta[name="google-signin-client_id"]');
    const m2 = document.querySelector('meta[name="lm:client_id"]');
    const s1 = document.querySelector('script[data-client_id]');
    const d1 = document.querySelector('[data-lm-client-id]');

    let cid = pick(m1,m2,s1,d1)
      || (window.LM_CONFIG && window.LM_CONFIG.client_id)
      || (window.__LM_BOOT && window.__LM_BOOT.clientId);

    if (typeof cid === 'string' && cid.trim()) {
      window.__LM_CLIENT_ID = cid.trim();
      return window.__LM_CLIENT_ID;
    }
    throw new Error('Missing client_id');
  }

  // ----------------------------- ensure GIS
  function ensureGIS(){
    return new Promise((resolve, reject)=>{
      if (window.google?.accounts?.oauth2?.initTokenClient){ log('GIS loaded'); return resolve(); }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.onload = ()=>{ log('GIS loaded'); resolve(); };
      s.onerror = ()=>reject(new Error('GIS load failed'));
      document.head.appendChild(s);
    });
  }

  // single-flight wrapper
  const inflight = new Map();
  async function singleFlight(key, fn){
    if (inflight.has(key)) return inflight.get(key);
    const p = (async()=>{
      try{ return await fn(); } finally { inflight.delete(key); }
    })();
    inflight.set(key, p);
    return p;
  }

  // ----------------------------- token client
  let tokenClient = null;
  function ensureTokenClient(){
    return singleFlight('tokenClient', async ()=>{
      const client_id = resolveClientId();
      await ensureGIS();
      tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id,
        scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
        callback: (resp)=>{ /* handled per request */ }
      });
      return tokenClient;
    });
  }

  // public: get access token
  window.__lm_getAccessToken = async function(){
    try{
      await ensureTokenClient();
    }catch(e){
      warn('signin failed:', e.message||String(e));
      throw e;
    }
    return await new Promise((resolve, reject)=>{
      try{
        tokenClient.requestAccessToken({
          prompt: 'consent',
          callback: (resp)=>{
            if (resp && resp.access_token){ log('signin ok'); resolve(resp.access_token); }
            else { const er = new Error('no access_token'); err(er); reject(er); }
          }
        });
      }catch(e){ err(e); reject(e); }
    });
  };

  log('auth shim ready');

  // ----------------------------- GLB resolver (Drive -> blob)
  const RX_DRIVE_ID = /drive\.google\.com\/file\/d\/([^/]+)/i;
  const RX_DRIVE_ID2 = /[?&]id=([a-zA-Z0-9_-]+)/;

  async function driveFileToBlobUrl(url){
    let id = null;
    let m = url.match(RX_DRIVE_ID); if (m) id = m[1];
    if (!id){ m = url.match(RX_DRIVE_ID2); if (m) id = m[1]; }
    if (!id) return null;

    const token = await window.__lm_getAccessToken();
    const api = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
    const res = await fetch(api, { headers:{ 'Authorization': 'Bearer '+token } });
    if (!res.ok){ throw new Error(`Drive fetch ${res.status}`); }
    const blob = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    log('glb resolved -> blob:', blobUrl);
    return blobUrl;
  }

  async function resolveUrlMaybeDrive(u){
    try{
      if (!u) return null;
      if (/^blob:|^data:|^https?:\/\//i.test(u) && !/drive\.google\.com/.test(u)) return u;
      const b = await driveFileToBlobUrl(u);
      return b || u;
    }catch(e){ err(e); throw e; }
  }

  // ----------------------------- viewer hand-off (best-effort multi path)
  async function handoffToViewer(url){
    // 0) notify world
    try{ window.dispatchEvent(new CustomEvent('lm:glb-url', {detail:{url}})); }catch(_){}

    // 1) Common bridges people use
    if (typeof window.loadGLB === 'function'){ try{ await window.loadGLB(url); return true; }catch(e){ warn('loadGLB failed', e);} }
    if (typeof window.loadModel === 'function'){ try{ await window.loadModel(url); return true; }catch(e){ warn('loadModel failed', e);} }
    if (window.viewer?.load){ try{ await window.viewer.load(url); return true; }catch(e){ warn('viewer.load failed', e);} }

    // 2) Fallback: stuff the input and synthesize Enter / click
    const input = qs('#glbUrl');
    const btn   = qs('#btnGlb');
    if (input){
      input.value = url;
      input.dispatchEvent(new Event('input', {bubbles:true}));
      input.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter', code:'Enter', bubbles:true}));
    }
    if (btn){
      btn.click();
    }

    return true;
  }

  // ----------------------------- wire UI
  function installWires(){
    const btnSignin = qs('#auth-signin');
    if (btnSignin && once(btnSignin, '__lm_wired')){
      btnSignin.addEventListener('click', async (ev)=>{
        ev.preventDefault();
        try{ await window.__lm_getAccessToken(); }catch(e){ err(e); }
      }, {capture:true});
      log('wired #auth-signin');
    }

    const btnGlb = qs('#btnGlb');
    if (btnGlb && once(btnGlb, '__lm_wired')){
      btnGlb.addEventListener('click', async (ev)=>{
        try{
          const u = qs('#glbUrl')?.value?.trim();
          if (!u) return;
          const resolved = await resolveUrlMaybeDrive(u);
          await handoffToViewer(resolved);
        }catch(e){ err(e); }
      }, {capture:true});
      log('wired #btnGlb');
    }

    const inp = qs('#glbUrl');
    if (inp && once(inp, '__lm_wired')){
      inp.addEventListener('keydown', async (ev)=>{
        if (ev.key !== 'Enter') return;
        try{
          const u = inp.value.trim();
          if (!u) return;
          const resolved = await resolveUrlMaybeDrive(u);
          await handoffToViewer(resolved);
        }catch(e){ err(e); }
      }, {capture:true});
      log('wired #glbUrl[Enter]');
    }

    // expose a manual API too
    window.__lm_resolveAndLoadGLB = async (u)=>{
      const resolved = await resolveUrlMaybeDrive(String(u||'').trim());
      return handoffToViewer(resolved);
    };

    log('boot safe stub ready');
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', installWires, {once:true});
  }else{
    installWires();
  }
})();
