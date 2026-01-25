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
  })();
