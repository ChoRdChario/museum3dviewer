import { getAccessToken } from './gauth.js';

async function gFetch(url, init={}){
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in');
  const res = await fetch(url, {
    ...init,
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type':'application/json', ...(init.headers||{}) }
  });
  if (!res.ok){
    const t = await res.text();
    throw new Error(res.status + ' : ' + t);
  }
  return res.json();
}

export async function ensureSpreadsheetForFile(fileId){
  // Try to find a spreadsheet named "LociMyu" in same folder
  const token = getAccessToken();
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const meta = await metaRes.json();
  const parent = (meta.parents||[])[0];
  if (!parent) throw new Error('No parent folder');
  const q = encodeURIComponent(`'${parent}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and name contains 'LociMyu'`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`, {
    headers:{ Authorization:`Bearer ${token}` }
  });
  const j = await res.json();
  if (j.files && j.files[0]) return { spreadsheetId: j.files[0].id };

  // create new
  const create = await gFetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method:'POST',
    body: JSON.stringify({ properties:{ title:'LociMyu' }, sheets:[{properties:{title:'Pins'}}] })
  });
  // move to parent
  await fetch(`https://www.googleapis.com/drive/v3/files/${create.spreadsheetId}?addParents=${parent}&removeParents=root`, {
    method:'PATCH', headers:{ Authorization:`Bearer ${token}` }
  });
  return { spreadsheetId: create.spreadsheetId };
}

export async function listSheetTitles(spreadsheetId){
  const j = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  return (j.sheets||[]).map(s=>s.properties.title);
}

export async function readSheet(spreadsheetId, sheetName){
  const j = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:Z10000`);
  return j.values||[];
}

export async function writeSheet(spreadsheetId, sheetName, values){
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1?valueInputOption=RAW`, {
    method:'PUT',
    body: JSON.stringify({ range:`${sheetName}!A1`, majorDimension:'ROWS', values })
  });
}
