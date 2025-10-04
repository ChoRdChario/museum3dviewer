// sheets_api.js — Google Sheets + Drive helpers for LociMyu
// Stores pins per GLB in a spreadsheet located in the same Drive folder as the GLB.
// Sheet name: 'Pins' with columns: id, x, y, z, title, body, imageId, updatedAt

function getAccessToken(){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in (no access token)');
  return access;
}

async function gFetch(url, options={}){
  const access = getAccessToken();
  const res = await fetch(url, {
    ...options,
    headers: { 'Authorization': `Bearer ${access}`, 'Content-Type':'application/json', ...(options.headers||{}) }
  });
  if (!res.ok){
    const t = await res.text().catch(()=>'');
    throw new Error(`${res.status} ${res.statusText}: ${t.slice(0,200)}`);
  }
  return res;
}

export async function driveGetFile(fileId){
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,parents,mimeType`;
  const res = await gFetch(url);
  return await res.json();
}

export async function driveListSpreadsheetsInFolder(folderId){
  const q = encodeURIComponent(`mimeType='application/vnd.google-apps.spreadsheet' and '${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`;
  const res = await gFetch(url);
  const j = await res.json();
  return j.files || [];
}

export async function sheetsCreate(title){
  const url = `https://sheets.googleapis.com/v4/spreadsheets`;
  const res = await gFetch(url, { method:'POST', body: JSON.stringify({ properties:{ title } }) });
  return await res.json(); // { spreadsheetId, ... }
}

export async function driveMoveFileToFolder(fileId, folderId){
  // First get current parents (to remove), then addParents
  const meta = await (await gFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`)).json();
  const prevParents = (meta.parents || []).join(',');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?addParents=${folderId}${prevParents?`&removeParents=${prevParents}`:''}&fields=id,parents`;
  const res = await gFetch(url, { method:'PATCH' });
  return await res.json();
}

export async function ensureSpreadsheetForFile(glbFileId){
  const file = await driveGetFile(glbFileId);
  const folderId = (file.parents && file.parents[0]) || null;
  if (!folderId) throw new Error('GLB file has no parent folder (cannot place spreadsheet)');
  const nameBase = file.name || glbFileId;
  const wanted = `LociMyu - ${nameBase} - data`;

  const existing = await driveListSpreadsheetsInFolder(folderId);
  const hit = existing.find(f => f.name === wanted) || existing[0];
  if (hit){
    await ensurePinsHeader(hit.id); // make sure sheet exists
    return { spreadsheetId: hit.id, title: hit.name };
  }

  // create new sheets, move under same folder
  const created = await sheetsCreate(wanted);
  const spreadsheetId = created.spreadsheetId;
  await driveMoveFileToFolder(spreadsheetId, folderId);
  await ensurePinsHeader(spreadsheetId);
  return { spreadsheetId, title: wanted };
}

export async function ensurePinsHeader(spreadsheetId){
  // Make sure there is a sheet 'Pins' and row 1 is header
  const urlGet = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`;
  const doc = await (await gFetch(urlGet)).json();
  const sheets = doc.sheets?.map(s=>s.properties.title) || [];
  if (!sheets.includes('Pins')){
    // add sheet
    await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method:'POST',
      body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:'Pins' } } }] })
    });
  }
  // set header
  const header = [['id','x','y','z','title','body','imageId','updatedAt']];
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pins!A1:H1?valueInputOption=RAW`, {
    method:'PUT',
    body: JSON.stringify({ range:'Pins!A1:H1', values: header })
  });
}

export async function loadPins(spreadsheetId){
  const res = await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pins!A2:H`);
  const j = await res.json();
  const rows = j.values || [];
  return rows.map(r => ({
    id: r[0],
    x: parseFloat(r[1]), y: parseFloat(r[2]), z: parseFloat(r[3]),
    title: r[4] || '',
    body: r[5] || '',
    imageId: r[6] || '',
    updatedAt: r[7] || ''
  })).filter(p => p.id);
}

export async function savePins(spreadsheetId, pins){
  // Clear then write
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pins!A2:H9999:clear`, { method:'POST' });
  const values = pins.map(p => [p.id, p.x, p.y, p.z, p.title||'', p.body||'', p.imageId||'', new Date().toISOString()]);
  if (!values.length) return;
  await gFetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Pins!A2?valueInputOption=RAW`, {
    method:'PUT',
    body: JSON.stringify({ range:'Pins!A2', values })
  });
}
