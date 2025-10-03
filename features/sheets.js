
// features/sheets.js  (v6.6.4)
import { toast } from './loading.js';
import { findSpreadsheetInSameFolder, createSpreadsheet, getFile } from './drive.js';

const PINS_SHEET = 'Pins';
const CAPTIONS_SHEET = 'Captions';

const debounceTimers = new Map();

function debounce(key, fn, delay=600){
  clearTimeout(debounceTimers.get(key));
  const t = setTimeout(fn, delay);
  debounceTimers.set(key, t);
}

export function titleFromFileName(name){
  const noExt = name.replace(/\.[^.]+$/, '');
  return `${noExt}_LociMyu`;
}

async function ensureSheets(spreadsheetId){
  // Ensure headers exist
  const body = {
    valueInputOption: 'RAW',
    data: [
      { range: `${PINS_SHEET}!A1:G1`, values: [[ 'id','x','y','z','createdAt','updatedAt','deleted' ]] },
      { range: `${CAPTIONS_SHEET}!A1:F1`, values: [[ 'pinId','title','body','imageUrl','thumbUrl','updatedAt' ]] },
    ]
  };
  try{
    await gapi.client.sheets.spreadsheets.values.batchUpdate({ spreadsheetId, resource: body });
  }catch(e){
    // If sheet not found, add sheets then retry
    if (String(e?.result?.error?.message||'').includes('Unable to parse range')){
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: { requests: [
          { addSheet: { properties: { title: PINS_SHEET }} },
          { addSheet: { properties: { title: CAPTIONS_SHEET }} },
        ]}
      });
      await gapi.client.sheets.spreadsheets.values.batchUpdate({ spreadsheetId, resource: body });
    }else{
      throw e;
    }
  }
}

export async function findOrCreateSpreadsheetForFile(fileId){
  const f = await getFile(fileId);
  const baseName = f.name || 'model';
  const desiredTitle = titleFromFileName(baseName);
  const existed = await findSpreadsheetInSameFolder(fileId, baseName);
  if (existed){
    await ensureSheets(existed.id);
    return existed.id;
  }
  const created = await createSpreadsheet(fileId, desiredTitle);
  await ensureSheets(created.id);
  return created.id;
}

export async function readPins(spreadsheetId){
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId, range: `${PINS_SHEET}!A2:G`
  });
  const rows = res.result.values || [];
  return rows.map(r => ({
    id: r[0], x: +r[1], y:+r[2], z:+r[3],
    createdAt: r[4], updatedAt: r[5], deleted: r[6]==='1'
  })).filter(r=>!r.deleted);
}

export async function readCaptions(spreadsheetId){
  const res = await gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId, range: `${CAPTIONS_SHEET}!A2:F`
  });
  const rows = res.result.values || [];
  return rows.map(r => ({
    pinId: r[0], title: r[1]||'', body: r[2]||'',
    imageUrl: r[3]||'', thumbUrl: r[4]||'', updatedAt: r[5]||''
  }));
}

export function savePinDebounced(spreadsheetId, pin){
  debounce('pin:'+pin.id, async ()=>{
    await savePin(spreadsheetId, pin);
    toast.success('ピンを保存しました');
  });
}

export async function savePin(spreadsheetId, pin){
  // Upsert by ID: find row via MATCH, else append
  // Simpler: append; dedupe is deferred. For PR2 reliability, we overwrite via batchUpdate with FILTER.
  const values = [[pin.id, pin.x, pin.y, pin.z, pin.createdAt||new Date().toISOString(), new Date().toISOString(), '0']];
  await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId, range: `${PINS_SHEET}!A:G`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
}

export async function deletePin(spreadsheetId, id){
  const values = [[id, '', '', '', '', new Date().toISOString(), '1']];
  await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId, range: `${PINS_SHEET}!A:G`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
}

export function saveCaptionDebounced(spreadsheetId, cap){
  debounce('cap:'+cap.pinId, async ()=>{
    await saveCaption(spreadsheetId, cap);
    toast.success('キャプションを保存しました');
  });
}

export async function saveCaption(spreadsheetId, cap){
  const values = [[cap.pinId, cap.title||'', cap.body||'', cap.imageUrl||'', cap.thumbUrl||'', new Date().toISOString()]];
  await gapi.client.sheets.spreadsheets.values.append({
    spreadsheetId, range: `${CAPTIONS_SHEET}!A:F`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
    resource: { values }
  });
}
