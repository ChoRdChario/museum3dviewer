// features/sheets_io.js  (v1c: tolerate missing parents -> use 'root')
export async function ensureSheetContext(glbFileId){
  const res = await gapi.client.drive.files.get({
    fileId: glbFileId,
    fields: 'id, name, parents'
  });
  if(res.status !== 200) throw new Error('drive meta failed');
  const file = res.result;
  const folderId = (file.parents && file.parents[0]) ? file.parents[0] : 'root'; // fallback
  const sheetName = 'captions';
  const spreadsheetId = await findOrCreateSpreadsheetInSameFolder(folderId, (file.name || 'model') + '_captions');
  return { folderId, spreadsheetId, sheetName };
}

async function findOrCreateSpreadsheetInSameFolder(folderId, name){
  const q = `mimeType='application/vnd.google-apps.spreadsheet' and name='${name.replace(/'/g, "\'")}'` +
            (folderId==='root' ? '' : ` and '${folderId}' in parents`);
  const list = await gapi.client.drive.files.list({ q, spaces:'drive', fields:'files(id,name,parents)', pageSize:10 });
  if(list.status===200 && list.result.files && list.result.files.length){
    return list.result.files[0].id;
  }
  const create = await gapi.client.sheets.spreadsheets.create({
    properties:{ title: name }
  });
  const id = create.result.spreadsheetId;
  if(folderId && folderId!=='root'){
    await gapi.client.drive.files.update({
      fileId: id,
      addParents: folderId,
      fields: 'id, parents'
    });
  }
  await ensureSheetTab(id, 'captions');
  return id;
}

async function ensureSheetTab(spreadsheetId, title){
  const get = await gapi.client.sheets.spreadsheets.get({ spreadsheetId });
  const has = (get.result.sheets||[]).some(s=>s.properties?.title===title);
  if(!has){
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requests:[{ addSheet:{ properties:{ title } } }]
    });
  }
}

export async function loadPinsFromSheet(spreadsheetId, title){
  const range = `'${title}'!A2:L`;
  const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range });
  const rows = res.result.values || [];
  return rows.map(r=>({
    id: r[0], x: +r[1]||0, y: +r[2]||0, z: +r[3]||0,
    title: r[4]||'', body: r[5]||'',
    imageFileId: r[6]||'', imageURL: r[7]||'',
    material: r[8]||'', updatedAt: r[9]||''
  }));
}

export async function savePinsDiff(spreadsheetId, title, pins){
  const header = [['id','x','y','z','title','body','imageFileId','imageURL','material','updatedAt']];
  const values = pins.map(p=>[p.id,p.x,p.y,p.z,p.title,p.body,p.imageFileId,p.imageURL,p.material,p.updatedAt]);
  await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId, range: `'${title}'!A:Z` });
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${title}'!A1`,
    valueInputOption: 'RAW',
    values: header.concat(values)
  });
}
