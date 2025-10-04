// sheets_api.js — extended to support sheet selection
function getAccessToken(){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in (no access token)');
  return access;
}
async function gFetch(url, options={}){
  const access = getAccessToken();
  const res = await fetch(url, { ...options, headers:{ 'Authorization':`Bearer ${access}`, 'Content-Type':'application/json', ...(options.headers||{}) } });
  if (!res.ok){ const t=await res.text().catch(()=> ''); throw new Error(`${res.status} ${res.statusText}: ${t.slice(0,200)}`); }
  return res;
}
export async function driveGetFile(fileId){
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents,mimeType`;
  const res = await gFetch(url); return await res.json();
}
export async function driveListSpreadsheetsInFolder(folderId){
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and '${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const res = await gFetch(url); const j = await res.json(); return j.files || [];
}
export async function sheetsCreate(title){
  const url = `https://sheets.googleapis.com/v4/spreadsheets`;
  const res = await gFetch(url, { method:'POST', body: JSON.stringify({ properties:{ title } }) });
  return await res.json();
}
export async function driveMoveFileToFolder(fileId, folderId){
  const meta = await (await gFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`)).json();
  const prevParents = (meta.parents || []).join(',');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${folderId}${prevParents?`&removeParents=${prevParents}`:''}&fields=id,parents`;
  const res = await gFetch(url, { method:'PATCH' }); return await res.json();
}
export async function ensureSpreadsheetForFile(glbFileId){
  const file = await driveGetFile(glbFileId);
  const folderId = (file.parents && file.parents[0]) || null;
  if (!folderId) throw new Error('GLB file has no parent folder');
  const wanted = `LociMyu - ${file.name || glbFileId} - data`;
  const existing = await driveListSpreadsheetsInFolder(folderId);
  const hit = existing.find(f => f.name === wanted) || existing[0];
  if (hit){ return { spreadsheetId: hit.id, title: hit.name, folderId }; }
  const created = await sheetsCreate(wanted);
  const spreadsheetId = created.spreadsheetId;
  await driveMoveFileToFolder(spreadsheetId, folderId);
  return { spreadsheetId, title: wanted, folderId };
}
export async function listSheetTitles(spreadsheetId){
  const urlGet = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const doc = await (await gFetch(urlGet)).json();
  return (doc.sheets || []).map(s=> s.properties.title);
}
export async function ensurePinsHeader(spreadsheetId, sheetName){
  const titles = await listSheetTitles(spreadsheetId);
  if (!titles.includes(sheetName)){
    await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method:'POST',
      body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:sheetName } } }] })
    });
  }
  const header = [['id','x','y','z','title','body','imageId','color','updatedAt']];
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A1:I1?valueInputOption=RAW`, {
    method:'PUT',
    body: JSON.stringify({ range:`${sheetName}!A1:I1`, values: header })
  });
}
export async function loadPins(spreadsheetId, sheetName){
  const res = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2:I`);
  const j = await res.json();
  const rows = j.values || [];
  return rows.map(r => ({
    id: r[0],
    x: parseFloat(r[1]), y: parseFloat(r[2]), z: parseFloat(r[3]),
    title: r[4] || '', body: r[5] || '', imageId: r[6] || '', color: r[7] || '#ffcc55', updatedAt: r[8] || ''
  })).filter(p => p.id);
}
export async function savePins(spreadsheetId, sheetName, pins){
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2:I9999:clear`, { method:'POST' });
  const values = pins.map(p => [p.id, p.x, p.y, p.z, p.title||'', p.body||'', p.imageId||'', p.color||'#ffcc55', new Date().toISOString()]);
  if (!values.length) return;
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}!A2?valueInputOption=RAW`, {
    method:'PUT',
    body: JSON.stringify({ range:`${sheetName}!A2`, values })
  });
}
