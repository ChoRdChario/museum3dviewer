// features/sheets_captions.js  (v6.6.1)
import { ensureAuth } from './drive_ctx.js';
const SHEET_TITLE = 'LociMyu Captions';
const CAPTIONS_TAB = 'Captions';

export async function findOrCreateSpreadsheetInSameFolder(folderId) {
  await ensureAuth();
  const q = `'${folderId}' in parents and trashed=false and mimeType='application/vnd.google-apps.spreadsheet' and name='${SHEET_TITLE}'`;
  const list = await gapi.client.drive.files.list({ q, fields: 'files(id,name,parents)' });
  if (list.result.files?.length) return list.result.files[0].id;
  const create = await gapi.client.sheets.spreadsheets.create({
    properties: { title: SHEET_TITLE },
    sheets: [ { properties: { title: CAPTIONS_TAB } } ]
  });
  const spreadsheetId = create.result.spreadsheetId;
  await gapi.client.drive.files.update({ fileId: spreadsheetId, addParents: folderId, removeParents: '', fields: 'id,parents' });
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId, range: `${CAPTIONS_TAB}!A1:K1`, valueInputOption: 'RAW',
    resource: { values: [[ 'pinId','matKey','x','y','z','title','body','imageId','imageURL','createdAt','updatedAt' ]]}
  });
  return spreadsheetId;
}
const _rowIndex = new Map();
export async function loadCaptions(spreadsheetId) {
  await ensureAuth();
  const r = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId, range: `${CAPTIONS_TAB}!A2:K` });
  const rows = r.result.values || [];
  _rowIndex.clear();
  return rows.map((v, i) => {
    const [pinId,matKey,x,y,z,title,body,imageId,imageURL,createdAt,updatedAt] = v;
    const rowNum = i + 2; if (pinId) _rowIndex.set(pinId, rowNum);
    return { pinId, matKey, position:[+x||0,+y||0,+z||0], title:title||'', body:body||'', imageId:imageId||'', imageURL:imageURL||'', createdAt, updatedAt };
  });
}
export async function upsertCaption(spreadsheetId, row) {
  await ensureAuth();
  const now = new Date().toISOString();
  const values = [[ row.pinId,row.matKey, row.position?.[0]??row.x??0, row.position?.[1]??row.y??0, row.position?.[2]??row.z??0, row.title||'',row.body||'', row.imageId||'',row.imageURL||'', row.createdAt||now, now ]];
  if (_rowIndex.has(row.pinId)) {
    const rn = _rowIndex.get(row.pinId);
    await gapi.client.sheets.spreadsheets.values.update({ spreadsheetId, range:`${CAPTIONS_TAB}!A${rn}:K${rn}`, valueInputOption:'USER_ENTERED', resource:{ values } });
  } else {
    await gapi.client.sheets.spreadsheets.values.append({ spreadsheetId, range:`${CAPTIONS_TAB}!A:K`, valueInputOption:'USER_ENTERED', insertDataOption:'INSERT_ROWS', resource:{ values } });
  }
}
