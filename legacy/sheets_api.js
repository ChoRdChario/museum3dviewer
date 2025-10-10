// sheets_api.js (stubbed for local dev)
// This file mimics a minimal subset of the real Spreadsheet API used by pins.js.
// Data is persisted to localStorage by "fileId" (or "demo") and "sheetName".

const KEY = 'loci_pins_v1';

function _readAll(){
  try{
    return JSON.parse(localStorage.getItem(KEY) || '{}');
  }catch(e){
    console.warn('[sheets_api] parse failed', e);
    return {};
  }
}
function _writeAll(obj){
  localStorage.setItem(KEY, JSON.stringify(obj));
}

export async function ensureSpreadsheetForFile(fileId){
  // In real implementation, creates/opens a spreadsheet bound to the GLB file.
  // Here we just return a pseudo id for UI display.
  const id = fileId || 'demo';
  console.log('[sheets_api] ensureSpreadsheetForFile', id);
  return id;
}

export async function ensurePinsHeader(fileId){
  // no-op in stub, but keeps contract
  console.log('[sheets_api] ensurePinsHeader for', fileId);
}

export async function listSheetTitles(fileId){
  const store = _readAll();
  const id = fileId || 'demo';
  const sheets = store[id] ? Object.keys(store[id]) : ['Pins'];
  console.log('[sheets_api] listSheetTitles', id, sheets);
  return sheets;
}

export async function loadPins(fileId, sheetName='Pins'){
  const store = _readAll();
  const id = fileId || 'demo';
  const rows = (store[id] && store[id][sheetName]) ? store[id][sheetName] : [];
  console.log('[sheets_api] loadPins', {id, sheetName, count: rows.length});
  return rows;
}

export async function savePins(fileId, sheetName='Pins', rows=[]){
  const store = _readAll();
  const id = fileId || 'demo';
  store[id] = store[id] || {};
  store[id][sheetName] = rows;
  _writeAll(store);
  console.log('[sheets_api] savePins', {id, sheetName, count: rows.length});
  return true;
}
