/*
 * picker.bridge.js — Google Picker foundation (Drive file selection)
 *
 * Principles
 *  - drive.file-only access: user must explicitly select files.
 *  - No Drive traversal/search from the app.
 *
 * Public API
 *  - window.__lm_pickerEnsureLoaded(): Promise<void>
 *  - window.__lm_openPicker(opts): Promise<{ action: string, docs?: Array<object>, raw: any }>
 *
 * opts (window.__lm_openPicker)
 *  - title?: string
 *  - multiselect?: boolean
 *  - viewId?: 'SPREADSHEETS'|'DOCS'|'FOLDERS'|'IMAGES'|'ALL'
 *  - mimeTypes?: string[]            // optional override for DocsView
 *  - fileIds?: string[]              // optional pre-navigation (Picker API setFileIds)
 *  - allowSharedDrives?: boolean
 *  - oauthToken?: string             // optional; by default uses window.__lm_getAccessToken()
 *  - origin?: string                 // optional; by default uses location.origin
 */

(function(){
  const LOG = (...a)=>console.log('[picker]', ...a);
  const ERR = (...a)=>console.error('[picker]', ...a);

  function getMeta(name){
    const m = document.querySelector('meta[name="' + name + '"]');
    return m ? (m.content || '').trim() : '';
  }

  function getApiKey(){
    // precedence: URL param -> localStorage -> window.__LM_API_KEY -> config -> meta
    try{
      const u = new URL(location.href);
      const v = u.searchParams.get('lm_api_key') || u.searchParams.get('api_key');
      if (v && v.trim()) {
        const key = v.trim();
        try { localStorage.setItem('LM_API_KEY', key); } catch(_e) {}
        window.__LM_API_KEY = key;
        return key;
      }
    }catch(_e){}

    try{
      const stored = localStorage.getItem('LM_API_KEY');
      if (stored && stored.trim()) return stored.trim();
    }catch(_e){}

    if (typeof window.__LM_API_KEY === 'string' && window.__LM_API_KEY.trim()) return window.__LM_API_KEY.trim();
    if (window.__LM_CONFIG && window.__LM_CONFIG.google && typeof window.__LM_CONFIG.google.apiKey === 'string' && window.__LM_CONFIG.google.apiKey.trim()) {
      return window.__LM_CONFIG.google.apiKey.trim();
    }
    const meta = getMeta('google-api-key');
    if (meta) return meta;
    return '';
  }

  function loadScriptOnce(src, id){
    return new Promise((resolve, reject)=>{
      try{
        if (id && document.getElementById(id)) return resolve();
        const existing = [...document.scripts].find(s => s && s.src === src);
        if (existing) return resolve();
        const s = document.createElement('script');
        if (id) s.id = id;
        s.src = src;
        s.async = true;
        s.defer = true;
        s.onload = ()=>resolve();
        s.onerror = (e)=>reject(new Error('Failed to load script: ' + src));
        document.head.appendChild(s);
      }catch(e){ reject(e); }
    });
  }

  let _ensurePromise = null;
  async function ensureLoaded(){
    if (_ensurePromise) return _ensurePromise;
    _ensurePromise = (async()=>{
      // Load gapi (Picker depends on it)
      if (!window.gapi) {
        await loadScriptOnce('https://apis.google.com/js/api.js', 'lm-gapi-api-js');
      }
      if (!window.gapi) throw new Error('gapi not available after loading api.js');

      // Load picker module
      await new Promise((resolve, reject)=>{
        try{
          window.gapi.load('picker', { callback: resolve, onerror: reject });
        }catch(e){ reject(e); }
      });

      if (!window.google || !window.google.picker) {
        throw new Error('google.picker not available after gapi.load(\'picker\')');
      }

      LOG('loaded');
    })();
    return _ensurePromise;
  }

  function resolveViewId(v){
    const p = window.google && window.google.picker;
    if (!p) return null;
    const ViewId = p.ViewId;
    const upper = String(v || '').toUpperCase();
    if (upper === 'SPREADSHEETS') return ViewId.SPREADSHEETS;
    if (upper === 'DOCS') return ViewId.DOCS;
    if (upper === 'FOLDERS') return ViewId.FOLDERS;
    if (upper === 'IMAGES') return ViewId.DOCS_IMAGES;
    if (upper === 'ALL') return ViewId.DOCS;
    return ViewId.DOCS;
  }

  async function openPicker(opts){
    const options = opts || {};
    await ensureLoaded();

    const apiKey = getApiKey();
    if (!apiKey) throw new Error('Missing API key for Picker (set window.__LM_API_KEY or meta google-api-key)');

    let token = options.oauthToken;
    if (!token) {
      if (typeof window.__lm_getAccessToken !== 'function') {
        throw new Error('Missing oauthToken and __lm_getAccessToken is not available');
      }
      token = await window.__lm_getAccessToken();
    }
    if (!token) throw new Error('OAuth token not available');

    const p = window.google.picker;

    const origin = (options.origin && String(options.origin).trim()) || location.origin;

    // Build view
    const viewId = resolveViewId(options.viewId || 'DOCS');
    let view;
    try{
      view = new p.DocsView(viewId);
    }catch(_e){
      // fallback
      view = new p.DocsView();
    }

    // Mime filter
    if (Array.isArray(options.mimeTypes) && options.mimeTypes.length) {
      try{ view.setMimeTypes(options.mimeTypes.join(',')); }catch(_e){}
    }

    // Pre-navigate to required fileIds (Picker Jan 2025 feature)
    if (Array.isArray(options.fileIds) && options.fileIds.length) {
      try{
        if (typeof view.setFileIds === 'function') view.setFileIds(options.fileIds);
      }catch(_e){}
    }

    // Shared Drives support
    if (options.allowSharedDrives) {
      try{ view.setIncludeFolders(true); }catch(_e){}
      try{ view.setEnableDrives(true); }catch(_e){}
    }

    // Promise wrapper around callback-based picker
    return new Promise((resolve, reject)=>{
      try{
        const callback = (data)=>{
          try{
            const action = data && data.action;
            if (!action) return;
            if (action === p.Action.PICKED) {
              const docs = (data.docs || []).map(d => Object.assign({}, d));
              resolve({ action: 'PICKED', docs, raw: data });
              return;
            }
            if (action === p.Action.CANCEL) {
              resolve({ action: 'CANCEL', raw: data });
              return;
            }
            // other actions
            resolve({ action: String(action), raw: data });
          }catch(e){ reject(e); }
        };

        let builder = new p.PickerBuilder()
          .setDeveloperKey(apiKey)
          .setOAuthToken(token)
          .setOrigin(origin)
          .addView(view)
          .setCallback(callback);

        if (options.title) {
          try{ builder.setTitle(String(options.title)); }catch(_e){}
        }

        if (options.multiselect) {
          builder = builder.enableFeature(p.Feature.MULTISELECT_ENABLED);
        }

        if (options.allowSharedDrives) {
          builder = builder.enableFeature(p.Feature.SUPPORT_DRIVES);
        }

        const picker = builder.build();
        picker.setVisible(true);
      }catch(e){
        ERR('openPicker failed', e);
        reject(e);
      }
    });
  }

  // Expose
  window.__lm_pickerEnsureLoaded = ensureLoaded;
  window.__lm_openPicker = openPicker;
})();
