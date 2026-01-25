// picker.bridge.module.js
// Google Picker loader + Promise-based open()
//
// Exposes:
//   window.__lm_openPicker({
//     title?: string,
//     viewId?: any,
//     mimeTypes?: string,
//     multiselect?: boolean,
//     fileIds?: string[],      // pre-navigate via setFileIds (2025+)
//     includeFolders?: boolean,
//     token?: string           // optional override
//   }) -> Promise<{action: string, docs: Array<{id,name,mimeType,url}>}>
//
// Reads configuration from config.js/meta tags:
//   - window.__LM_API_KEY (developerKey)
// Requires an OAuth token from boot.*:
//   - window.__lm_getAccessToken() or window.getAccessToken()

let _apiJsLoading = null;
let _pickerReady = false;

function getApiKey(){
  try{
    if (typeof window.__LM_API_KEY === 'string' && window.__LM_API_KEY.trim()) return window.__LM_API_KEY.trim();
    const m = document.querySelector('meta[name="google-api-key"]');
    if (m && m.content && m.content.trim()) return m.content.trim();
  }catch(_e){}
  return '';
}

async function getToken(){
  try{
    if (typeof window.__lm_getAccessToken === 'function') return await window.__lm_getAccessToken();
  }catch(_e){}
  try{
    if (typeof window.getAccessToken === 'function') return await window.getAccessToken();
  }catch(_e){}
  // Fallback: import gauth.module.js if available.
  try{
    const g = await import('./gauth.module.js');
    if (g && typeof g.getAccessToken === 'function') return await g.getAccessToken();
  }catch(_e){}
  throw new Error('No OAuth access token provider found');
}

function loadApiJsOnce(){
  if (_apiJsLoading) return _apiJsLoading;
  _apiJsLoading = new Promise((resolve, reject)=>{
    if (window.gapi && typeof window.gapi.load === 'function'){
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://apis.google.com/js/api.js';
    s.async = true;
    s.defer = true;
    s.onload = ()=>resolve();
    s.onerror = (e)=>reject(e);
    document.head.appendChild(s);
  });
  return _apiJsLoading;
}

async function ensurePickerReady(){
  if (_pickerReady) return;
  await loadApiJsOnce();
  await new Promise((resolve, reject)=>{
    try{
      window.gapi.load('picker', { callback: ()=>resolve(), onerror: (e)=>reject(e) });
    }catch(e){
      reject(e);
    }
  });
  _pickerReady = true;
}

function mapDocs(data){
  const docs = (data && data.docs) ? data.docs : [];
  return docs.map(d=>({
    id: d.id,
    name: d.name,
    mimeType: d.mimeType,
    url: d.url
  }));
}

async function openPicker(opts = {}){
  await ensurePickerReady();

  const developerKey = getApiKey();
  if (!developerKey){
    throw new Error('Missing API key for Google Picker (window.__LM_API_KEY / meta[google-api-key])');
  }

  const token = (opts && typeof opts.token === 'string' && opts.token) ? opts.token : await getToken();

  const title = (opts && opts.title) ? String(opts.title) : 'Select files';
  const multiselect = !!(opts && opts.multiselect);
  const includeFolders = !!(opts && opts.includeFolders);
  const fileIds = Array.isArray(opts && opts.fileIds) ? opts.fileIds.filter(Boolean).map(String) : null;

  // Resolve viewId.
  // - Accept either Picker.ViewId constant value (recommended)
  // - Or accept string key like 'DOCS' / 'SPREADSHEETS' / 'FOLDERS'.
  const Picker = window.google && window.google.picker;
  let viewId = (opts && opts.viewId) || (Picker && Picker.ViewId && Picker.ViewId.DOCS);
  try{
    if (typeof viewId === 'string' && Picker && Picker.ViewId && Picker.ViewId[viewId]){
      viewId = Picker.ViewId[viewId];
    }
  }catch(_e){}

  // DocsView supports most configuration; for spreadsheets we pass ViewId.SPREADSHEETS.
  let view;
  try{
    view = new window.google.picker.DocsView(viewId);
  }catch(_e){
    // Fallback: use default view if DocsView ctor rejects.
    view = new window.google.picker.DocsView();
  }

  try{
    if (opts && opts.mimeTypes) view.setMimeTypes(String(opts.mimeTypes));
  }catch(_e){}

  try{
    if (includeFolders && typeof view.setIncludeFolders === 'function') view.setIncludeFolders(true);
  }catch(_e){}

  // Folder picking: must explicitly allow selecting folders.
  try{
    if (Picker && Picker.ViewId && viewId === Picker.ViewId.FOLDERS && typeof view.setSelectFolderEnabled === 'function'){
      view.setSelectFolderEnabled(true);
    }
  }catch(_e){}

  // 2025+: pre-navigate to specific file ids
  try{
    if (fileIds && typeof view.setFileIds === 'function') view.setFileIds(fileIds);
  }catch(_e){}

  return await new Promise((resolve, reject)=>{
    try{
      const callback = (data)=>{
        const action = data && data.action;
        if (action === window.google.picker.Action.PICKED){
          resolve({ action, docs: mapDocs(data) });
        }else if (action === window.google.picker.Action.CANCEL){
          resolve({ action, docs: [] });
        }else{
          resolve({ action: String(action || ''), docs: mapDocs(data) });
        }
      };

      const builder = new window.google.picker.PickerBuilder()
        .setOAuthToken(token)
        .setDeveloperKey(developerKey)
        .setTitle(title)
        .setCallback(callback);

      // Avoid origin mismatch errors on GH Pages.
      try{ builder.setOrigin(window.location.origin); }catch(_e){}

      builder.addView(view);

      if (multiselect){
        try{ builder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED); }catch(_e){}
      }

      // Shared Drives support (if requested)
      try{
        if (opts && opts.allowSharedDrives){
          const F = window.google.picker.Feature;
          // Different names exist across Picker versions
          if (F.SUPPORT_DRIVES) builder.enableFeature(F.SUPPORT_DRIVES);
          if (F.SUPPORT_TEAM_DRIVES) builder.enableFeature(F.SUPPORT_TEAM_DRIVES);
        }
      }catch(_e){}

      const picker = builder.build();
      picker.setVisible(true);
    }catch(e){
      reject(e);
    }
  });
}

window.__lm_openPicker = openPicker;
