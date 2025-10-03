// features/sheets_io.js
// Ensure spreadsheet context in the same folder as the GLB, load pins, save diffs.

const LOG = (...a)=>console.log('[sheets]', ...a);
const WARN = (...a)=>console.warn('[sheets]', ...a);

function getParam(name){
  const u = new URL(location.href);
  return u.searchParams.get(name);
}

export async function ensureSheetContext(glbFileId){
  // try to use existing drive helper if present
  if(window.drive?.findOrCreateSpreadsheetInSameFolder){
    const ss = await window.drive.findOrCreateSpreadsheetInSameFolder(glbFileId, 'captions');
    // expected to return {spreadsheetId, folderId, sheetName}
    return ss;
  }
  // fallback: determine parent folder, then find or create spreadsheet
  const fileRes = await gapi.client.drive.files.get({ fileId: glbFileId, fields:'id, name, parents' });
  const folderId = (fileRes.result.parents||[])[0];
  if(!folderId) throw new Error('no parent folder');
  // search spreadsheet in folder
  const q = [`'${folderId}' in parents`, "mimeType = 'application/vnd.google-apps.spreadsheet'", 'trashed = false'].join(' and ');
  const list = await gapi.client.drive.files.list({ q, fields:'files(id,name)', pageSize:50 });
  let spreadsheetId = list.result.files?.[0]?.id;
  if(!spreadsheetId){
    const created = await gapi.client.sheets.spreadsheets.create({
      properties:{ title:'LociMyu_captions' },
      sheets:[{ properties:{ title:'captions' } }]
    });
    spreadsheetId = created.result.spreadsheetId;
    // move to folder
    await gapi.client.drive.files.update({ fileId: spreadsheetId, addParents: folderId, removeParents: '', fields:'id, parents' });
  }
  const sheetName = getParam('sheet') || 'captions';
  // ensure sheet exists
  await ensureSheetExists(spreadsheetId, sheetName);
  return { spreadsheetId, folderId, sheetName };
}

async function ensureSheetExists(spreadsheetId, sheetName){
  const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const has = meta.result.sheets?.some(s=>s.properties?.title===sheetName);
  if(!has){
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requests:[{ addSheet:{ properties:{ title: sheetName } } }]
    });
  }
}

// Schema header
const HEADER = ['id','x','y','z','title','body','imageFileId','imageURL','material','updatedAt'];

export async function loadPinsFromSheet(spreadsheetId, sheetName){
  // read rows
  const range = `${sheetName}!A1:J10000`;
  const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.result.values || [];
  if(rows.length === 0) return [];
  // ensure header present
  let start = 1;
  if(rows[0].join(',') !== HEADER.join(',')){ start = 0; }
  const out = [];
  for(let i = start; i < rows.length; i++){
    const r = rows[i];
    const o = {};
    HEADER.forEach((k, idx)=> o[k] = r[idx] ?? '');
    // number fields
    o.x = parseFloat(o.x)||0; o.y = parseFloat(o.y)||0; o.z = parseFloat(o.z)||0;
    out.push(o);
  }
  return out;
}

export async function savePinsDiff(spreadsheetId, sheetName, pins){
  // write header + all pins (simple approach; later can optimize to true diff)
  const values = [HEADER];
  for(const p of pins){
    values.push(HEADER.map(k=> (p[k] ?? '').toString()));
  }
  const range = `${sheetName}!A1:J${Math.max(2, values.length)}`;
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId, range, valueInputOption:'RAW',
    body:{ values }
  });
  LOG('saved rows', values.length-1);
}
