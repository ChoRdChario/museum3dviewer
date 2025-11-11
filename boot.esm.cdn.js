/* LociMyu boot — minimal auth+GLB wire (reliable) 2025-11-11 16:10:10 */
(function(){
  'use strict';

  const TAG = '[LM-boot.min]';

  // -------- tiny util --------
  function log(){ try{ console.log(TAG, ...arguments); }catch(_){}} 
  function warn(){ try{ console.warn(TAG, ...arguments); }catch(_){}} 
  function qs(sel){ return document.querySelector(sel); }
  function once(el, ev, fn){ el && el.addEventListener(ev, fn, {once:true}); }

  // -------- client_id resolution (defensive & ordered) --------
  function readMeta(name){
    const m = document.querySelector(`meta[name="${name}"]`);
    return m && m.content || '';
  }
  function readQuery(keys){
    try{ const u = new URL(location.href); for(const k of keys){ const v=u.searchParams.get(k); if(v) return v; } }catch(_){}
    return '';
  }
  function readScriptData(){
    try{ const s=[...document.scripts].find(x=>/boot\.esm\.cdn\.js/.test(x.src)); 
      if(s) return s.dataset['lmClientId'] || s.getAttribute('data-lm-client-id') || ''; 
    }catch(_){}
    return '';
  }

  function resolveClientId(){
    const cand = [
      window.__LM_CLIENT_ID,
      readQuery(['gis_client_id','client_id']),
      readScriptData(),
      window.GIS_CLIENT_ID,
      readMeta('google-signin-client_id'),
      window.__BOOT_BRIDGE__ && window.__BOOT_BRIDGE__.client_id
    ].map(x => (x||'').trim()).filter(Boolean);
    const id = cand[0] || ''; // first non-empty
    if(!id) warn('signin failed: Missing required parameter client_id.');
    return id;
  }

  // -------- Google Identity Services (token client) --------
  let _tokenClient = null;
  let _tok = null;
  const DEFAULT_SCOPES = (window.LM_SCOPES || [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive.readonly'
  ]).join(' ');

  function loadGIS(){
    return new Promise((res, rej)=>{
      if (window.google && window.google.accounts && window.google.accounts.oauth2) return res();
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true; s.defer = true;
      s.onload = ()=>res();
      s.onerror = ()=>rej(new Error('GIS load failed'));
      document.head.appendChild(s);
    });
  }

  async function ensureTokenClient(){
    await loadGIS();
    if (_tokenClient) return _tokenClient;
    const client_id = resolveClientId();
    if (!client_id) throw new Error('Missing client_id');

    _tokenClient = google.accounts.oauth2.initTokenClient({
      client_id,
      scope: DEFAULT_SCOPES,
      prompt: '',
      callback: (resp)=>{ 
        if(resp && resp.access_token){ _tok = resp.access_token; }
      }
    });
    log('auth shim ready');
    return _tokenClient;
  }

  // Expose: getAccessToken (popup-safe)
  window.__lm_getAccessToken = async function(){
    await ensureTokenClient();
    return new Promise((resolve, reject)=>{
      try{
        _tokenClient.requestAccessToken({
          prompt: '',
          // when an access token already exists, GIS may refresh silently
          // we still provide a callback via initTokenClient above
        });
        // poll for token (simple, robust)
        let t=0;
        const iv = setInterval(()=>{
          if (_tok) { clearInterval(iv); resolve(_tok); }
          else if ((t+=100) > 5000) { clearInterval(iv); reject(new Error('token timeout')); }
        }, 100);
      }catch(e){ reject(e); }
    });
  };

  // Expose: fetch wrapper with Bearer
  window.__lm_fetchJSONAuth = async function(url, opt){
    const token = await window.__lm_getAccessToken();
    const o = Object.assign({}, opt||{});
    o.headers = Object.assign({}, o.headers||{}, { 'Authorization': 'Bearer '+token });
    const r = await fetch(url, o);
    if (!r.ok) throw new Error('HTTP '+r.status+': '+url);
    const ct = r.headers.get('content-type')||'';
    return ct.includes('application/json') ? r.json() : r.text();
  };

  // -------- GLB loader wire (reuses existing UI) --------
  function wireGLB(){
    const input = qs('#glbUrl');
    const btn = qs('#btnGlb');
    if (!input || !btn) return log('glb wire skipped (no UI)');
    btn.addEventListener('click', ()=>{
      const url = String(input.value||'').trim();
      if(!url) return;
      const ev = new CustomEvent('lm:load-glb', { detail: { url } });
      window.dispatchEvent(ev);
      log('glb wire ready');
    }, { once: true });
  }

  // -------- boot --------
  (function boot(){
    wireGLB();
    // Preload GIS in background; token will be requested on demand
    loadGIS().then(()=>log('GIS loaded')).catch(()=>{});
  })();

})();