// [caption.images.loader] Phase B1 — Drive sibling images loader for captions
// - Uses window.__LM_ACTIVE_GLB_ID set by glb.btn.bridge.v3.js
// - Calls drive.images.list.js (listSiblingImagesByGlbId)
// - Pushes results into __LM_CAPTION_UI.setImages(images)
(function(){
  const TAG='[caption.images.loader]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/files';

  let inflight = null;
  const metaCache = new Map();

  function getActiveGlbId(){
    const ctx = window.__lm_ctx || window.__LM_SAVE_CTX || {};
    return window.__LM_ACTIVE_GLB_ID || ctx.glbFileId || null;
  }

  function uniq(arr){
    const out = [];
    const seen = new Set();
    for (const x of (arr||[])){
      const v = String(x||'').trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  async function getAuthFetch(){
    if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
    try{
      const m = await import('./auth.fetch.bridge.js');
      if (typeof m.default === 'function') return await m.default();
    }catch(_e){}
    if (typeof window.__lm_fetchJSONAuth === 'function') return window.__lm_fetchJSONAuth;
    throw new Error('auth fetch missing');
  }

  async function fetchDriveMeta(fileId){
  if (metaCache.has(fileId)) return metaCache.get(fileId);

  const id = String(fileId||'').trim();
  const authFetch = getAuthFetch(); // may be null if token missing

  const urlBase = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=${encodeURIComponent(FIELDS)}&supportsAllDrives=true`;

  const fetchAuth = async ()=>{
    if (!authFetch) throw new Error('No auth fetch');
    return await authFetch(urlBase);
  };

  const fetchPublic = async ()=>{
    const key = (typeof window.__LM_API_KEY === 'string' && window.__LM_API_KEY.trim()) ? window.__LM_API_KEY.trim() : '';
    if (!key) throw new Error('No API key');
    const url = `${urlBase}&key=${encodeURIComponent(key)}`;
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error(`Drive public meta fetch failed ${res.status}`);
    return await res.json();
  };

  const prom = (async ()=>{
    try{
      return await fetchAuth();
    }catch(e){
      // Retry public for likely access failures (drive.file does not cover link-only public files).
      try{
        return await fetchPublic();
      }catch(_e2){
        throw e;
      }
    }
  })();

  metaCache.set(id, prom);
  return prom;
}

  async function loadImages(reason){
    const ui = window.__LM_CAPTION_UI;
    const glbId = getActiveGlbId();
    if (!ui || typeof ui.setImages !== 'function'){
      warn('no caption UI yet; skip images', reason);
      return;
    }
    if (!glbId){
      warn('no active GLB id; set empty images', reason);
      ui.setImages([]);
      try{
        window.__LM_READY_GATE__?.mark?.('images', {
          reason,
          glbId: null,
          mode: window.__LM_POLICY_DRIVEFILE_ONLY ? 'drive.file' : 'drive.folder'
        });
      }catch(_){ }
      return;
    }

    // In drive.file mode we must not perform folder scanning/listing.
    // Instead we resolve explicit attachment fileIds collected from caption sheets.
    if (window.__LM_POLICY_DRIVEFILE_ONLY){
      const ids = uniq(window.__LM_CANDIDATE_IMAGE_FILEIDS || []);
      if (!ids.length){
        ui.setImages([]);
        log('drive.file mode: no candidate image fileIds', reason);
        try{
          window.__LM_READY_GATE__?.mark?.('images', {
            reason,
            glbId,
            mode: 'drive.file',
            count: 0,
            note: 'no candidates'
          });
        }catch(_){ }
        return;
      }

      // Resolve metadata for thumbnails/labels.
      const metas = [];
      for (const id of ids.slice(0, 200)){
        // Sequential to avoid rate bursts; number is typically small.
        metas.push(await fetchDriveMeta(id));
      }
      const imgs = metas.map(m=>({
        id: m.id,
        name: m.name || '',
        mimeType: m.mimeType || '',
        thumbUrl: m.thumbnailUrl || m.url || '',
        url: m.url || ''
      }));
      ui.setImages(imgs);
      try{
        window.__LM_READY_GATE__?.mark?.('images', {
          reason,
          glbId,
          mode: 'drive.file',
          count: Array.isArray(imgs) ? imgs.length : null
        });
      }catch(_){ }
      log('drive.file images loaded', imgs.length, 'reason:', reason);
      return;
    }
    try{
      const mod = await import('./drive.images.list.js');
      const fn = mod.listSiblingImagesByGlbId || mod.listSiblingImages || mod.default;
      if (typeof fn !== 'function'){
        warn('drive.images.list.js missing listSiblingImagesByGlbId');
        ui.setImages([]);
        try{
          window.__LM_READY_GATE__?.mark?.('images', {
            reason,
            glbId,
            mode: 'drive.folder',
            count: 0,
            note: 'no list function'
          });
        }catch(_){ }
        return;
      }
      const raw = await fn(glbId);
      const imgs = (raw || []).map(r=>({
        id: r.id,
        name: r.name || '',
        mimeType: r.mimeType || '',
        thumbUrl: r.thumbnailUrl || r.thumbUrl || r.url || '',
        url: r.url || r.webContentLink || r.webViewLink || ''
      }));
      ui.setImages(imgs);
      try{
        window.__LM_READY_GATE__?.mark?.('images', {
          reason,
          glbId,
          mode: 'drive.folder',
          count: Array.isArray(imgs) ? imgs.length : null
        });
      }catch(_){ }
      log('images loaded', imgs.length, 'reason:', reason);
    }catch(e){
      warn('image listing failed', e);
      try{
        const ui2 = window.__LM_CAPTION_UI;
        if (ui2 && typeof ui2.setImages === 'function') ui2.setImages([]);
      }catch(_){}
      try{
        window.__LM_READY_GATE__?.mark?.('images', {
          reason,
          glbId,
          mode: 'drive.folder',
          count: 0,
          note: 'listing failed'
        });
      }catch(_){ }
    }
  }

  function trigger(reason){
    if (inflight){
      // let previous finish; start new after that
      inflight.finally(()=>{
        inflight = loadImages(reason);
      });
      return;
    }
    inflight = loadImages(reason).finally(()=>{ inflight = null; });
  }

  window.addEventListener('load', ()=>trigger('window-load'));
  document.addEventListener('lm:caption-ui-ready', ()=>trigger('caption-ui-ready'));
  document.addEventListener('lm:refresh-images', ()=>trigger('manual-refresh'));

  log('armed');
})();