// save.locator.js — GLB親フォルダにセーブシートを gid-first で find/create
(function(){
  const TAG='[save]';
  const log=(...a)=>console.log(TAG, ...a);
  const err=(...a)=>console.error(TAG, ...a);
  const DRIVE='https://www.googleapis.com/drive/v3';
  const SHEETS='https://sheets.googleapis.com/v4/spreadsheets';

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

  async function authFetch(url, opt={}){
    const tok = typeof window.__lm_getAccessToken==='function' ? await window.__lm_getAccessToken()
              : (await import('./gauth.module.js')).getAccessToken ? await (await import('./gauth.module.js')).getAccessToken()
              : null;
    if (!tok) throw new Error('no token');
    opt.headers = Object.assign({}, opt.headers||{}, { 'Authorization': `Bearer ${tok}`, 'Content-Type':'application/json' });
    return fetch(url, opt);
  }

  async function getGlbParent(fileId){
    const url = `${DRIVE}/files/${fileId}?fields=id,name,parents`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('files.get failed '+res.status);
    const data = await res.json();
    const parent = (data.parents && data.parents[0]) || null;
    log('parent folder:', parent);
    return { parentId: parent, name: data.name };
  }

  async function findSaveSheetInFolder(parentId){
    if (!parentId) return null;
    const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet'`);
    const url = `${DRIVE}/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`;
    const res = await authFetch(url);
    if (!res.ok) throw new Error('files.list failed '+res.status);
    const data = await res.json();
    const f = (data.files||[])[0] || null;
    if (f) log('found existing:', f.id, f.name);
    return f;
  }

  async function createSaveSheetInFolder(parentId, title){
    const body = { properties: { title } };
    const res = await authFetch(`${SHEETS}`, { method:'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('spreadsheets.create failed '+res.status);
    const data = await res.json();
    const spreadsheetId = data.spreadsheetId;
    log('created spreadsheet:', spreadsheetId, title);
    if (parentId){
      const move = await authFetch(`${DRIVE}/files/${spreadsheetId}?addParents=${parentId}&removeParents=&fields=id,parents`, { method:'PATCH' });
      if (!move.ok) err('files.update(move) failed', move.status);
    }
    try{
      await ensureDefaultCaptionSheet(spreadsheetId);
    }catch(e){ err('ensure default caption sheet failed', e); }
    return spreadsheetId;
  }

  async function ensureDefaultCaptionSheet(spreadsheetId){
    const get = await authFetch(`${SHEETS}/${spreadsheetId}?fields=sheets(properties(sheetId,title))`);
    if (!get.ok) throw new Error('spreadsheets.get failed '+get.status);
    const data = await get.json();
    const has = (data.sheets||[]).some(s => (s.properties||{}).title==='caption_default');
    if (has) return;
    const body = { requests:[ { addSheet:{ properties:{ title:'caption_default' } } } ] };
    const res = await authFetch(`${SHEETS}/${spreadsheetId}:batchUpdate`, { method:'POST', body: JSON.stringify(body) });
    if (!res.ok) throw new Error('batchUpdate add caption_default failed '+res.status);
  }

  async function getDefaultCaptionGid(spreadsheetId){
    const res = await authFetch(`${SHEETS}/${spreadsheetId}?fields=sheets(properties(sheetId,title,index))`);
    if (!res.ok) return null;
    const data = await res.json();
    const def = (data.sheets||[]).find(s=> (s.properties||{}).title==='caption_default') || (data.sheets||[])[0];
    return def ? String(def.properties.sheetId) : null;
  }

  async function findOrCreateSaveSheetByGlbId(fileIdOrUrl){
    const id = extractId(fileIdOrUrl);
    if (!id) throw new Error('invalid fileId/url');
    const { parentId, name } = await getGlbParent(id);
    const existing = await findSaveSheetInFolder(parentId);
    let spreadsheetId = existing ? existing.id : null;
    let created = false;
    if (!spreadsheetId){
      const title = `LociMyu_${(name||'model').replace(/\.[^.]+$/,'')}_save`;
      spreadsheetId = await createSaveSheetInFolder(parentId, title);
      created = true;
    }
    const defaultCaptionGid = await getDefaultCaptionGid(spreadsheetId);
    return { spreadsheetId, created, defaultCaptionGid };
  }

  window.__lm_findOrCreateSaveSheet = findOrCreateSaveSheetByGlbId;
  window.__lm_getDefaultCaptionGid = getDefaultCaptionGid;
  window.saveLocator = { findOrCreateSaveSheetByGlbId, getDefaultCaptionGid };
  if (typeof window !== 'undefined') window.findOrCreateSaveSheetByGlbId = findOrCreateSaveSheetByGlbId;
})();

// --- ESM compatibility exports (module import) ---
export const findOrCreateSaveSheetByGlbId = (typeof window !== 'undefined' && window.findOrCreateSaveSheetByGlbId) ? window.findOrCreateSaveSheetByGlbId : undefined;
export const getDefaultCaptionGid = (typeof window !== 'undefined' && window.getDefaultCaptionGid) ? window.getDefaultCaptionGid : undefined;
export default { findOrCreateSaveSheetByGlbId, getDefaultCaptionGid };
