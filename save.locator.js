
// save.locator.js
// Finds or creates a LociMyu save spreadsheet next to the GLB in Drive,
// ensures __LM_MATERIALS header row, and dispatches lm:sheet-context.

import ensureAuthBridge from './auth.fetch.bridge.js';

const SHEETS_BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_BASE  = 'https://www.googleapis.com/drive/v3';

// Public API
export async function findOrCreateSaveSheetByGlbId(glbFileId){
  const fetchAuth = await needAuth();

  // 1) resolve GLB parent folder
  const glb = await fetchAuth(`${DRIVE_BASE}/files/${encodeURIComponent(glbFileId)}?fields=id,name,parents,mimeType`);
  const parents = glb.parents || [];
  const parentId = parents[0] || null; // may be null if no parent (My Drive root)

  // 2) search existing "LociMyu Save" in same folder
  let q = `mimeType='application/vnd.google-apps.spreadsheet' and trashed=false and name contains 'LociMyu Save'`;
  if (parentId) q += ` and '${parentId}' in parents`;
  const existing = await fetchAuth(`${DRIVE_BASE}/files?q=${encodeURIComponent(q)}&fields=files(id,name,parents)`);
  let sheetId = existing.files?.[0]?.id || null;

  if (!sheetId){
    // 3) create spreadsheet file in the same folder via Drive (so location is correct)
    const meta = { name: 'LociMyu Save', mimeType: 'application/vnd.google-apps.spreadsheet' };
    if (parentId) meta.parents = [parentId];

    // Use Drive v3 Files.create (multipart/related metadata only since it's a native type)
    const boundary = '-------lm_boundary_' + Math.random().toString(16).slice(2);
    const body =
      `--${boundary}\r\n` +
      `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify(meta)}\r\n` +
      `--${boundary}--`;

    const created = await fetchAuth(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
      { method: 'POST',
        headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
        body
      }
    );
    sheetId = created.id;
  }

  // 4) ensure materials sheet header
  const { materialsGid } = await ensureMaterialsHeader(sheetId);

  // 5) ensure at least one caption sheet exists and pick default
  const defaultCaptionGid = await ensureDefaultCaptionSheet(sheetId);

  // 6) publish context
  publishSheetContext({ spreadsheetId: sheetId, materialsGid, defaultCaptionGid });

  return { spreadsheetId: sheetId, materialsGid, defaultCaptionGid };
}

export async function __debug_createNow(name='LociMyu Debug'){
  const fetchAuth = await needAuth();
  // Create in root (My Drive) for debug
  const meta = { name, mimeType: 'application/vnd.google-apps.spreadsheet' };

  const boundary = '-------lm_boundary_' + Math.random().toString(16).slice(2);
  const body =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(meta)}\r\n` +
    `--${boundary}--`;

  const created = await fetchAuth(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',
    { method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    }
  );

  const { materialsGid } = await ensureMaterialsHeader(created.id);
  const defaultCaptionGid = await ensureDefaultCaptionSheet(created.id);
  publishSheetContext({ spreadsheetId: created.id, materialsGid, defaultCaptionGid });
  return created;
}

// Internals
async function needAuth(){
  const fn = await ensureAuthBridge();
  if (typeof fn !== 'function') throw new Error('__lm_fetchJSONAuth not found');
  return fn;
}

async function listSheets(spreadsheetId){
  const fetchAuth = await needAuth();
  const meta = await fetchAuth(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties`);
  const list = (meta.sheets || []).map(s => s.properties);
  return list;
}

async function ensureMaterialsHeader(spreadsheetId, opts = {}) {
  const fetchAuth = await needAuth();

  // Delegate header/schema creation to boot-side helper if available
  if (typeof window.__lm_ensureMaterialsHeader === 'function'){
    try{
      await window.__lm_ensureMaterialsHeader(spreadsheetId);
    }catch(e){
      console.warn('[save.locator] __lm_ensureMaterialsHeader failed', e);
    }
  }

  // List sheets and locate __LM_MATERIALS to obtain its gid
  const props = await listSheets(spreadsheetId);
  let mat = props.find(p => p.title === '__LM_MATERIALS');

  // Fallback: create the sheet if it somehow does not exist
  if (!mat){
    const res = await fetchAuth(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      json: { requests: [{ addSheet: { properties: { title: '__LM_MATERIALS', gridProperties: { rowCount: 1000, columnCount: 26 } } } }] }
    });
    mat = res?.replies?.[0]?.addSheet?.properties;
  }

  return { materialsGid: mat.sheetId };
}


async function ensureDefaultCaptionSheet(spreadsheetId, opts = {}) {
  const fetchAuth = await needAuth();
  const props = await listSheets(spreadsheetId);
  // Find first non-materials sheet
  let cap = props.find(p => p.title !== '__LM_MATERIALS');
  if (!cap){
    const res = await fetchAuth(`${SHEETS_BASE}/${encodeURIComponent(spreadsheetId)}:batchUpdate`, {
      method: 'POST',
      json: { requests: [{ addSheet: { properties: { title: 'Captions', gridProperties: { rowCount: 1000, columnCount: 12 } } } }] }
    });
    cap = res?.replies?.[0]?.addSheet?.properties;
  }
  return cap.sheetId;
}

function publishSheetContext({ spreadsheetId, materialsGid, defaultCaptionGid }){
  // keep a cache on window
  window.__lm_ctx = Object.assign(window.__lm_ctx || {}, { spreadsheetId, materialsGid, defaultCaptionGid });
  document.dispatchEvent(new CustomEvent('lm:sheet-context', { detail: { spreadsheetId, materialsGid, defaultCaptionGid } }));
  console.log('[save.locator] ready', { spreadsheetId, materialsGid, defaultCaptionGid });
}
