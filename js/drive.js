const MIME_SPREADSHEET='application/vnd.google-apps.spreadsheet';
async function getFile(fileId){ const res=await gapi.client.drive.files.get({ fileId, fields:'id,name,parents' }); return res.result; }
async function listSpreadsheetsInFolder(folderId){
  const q=`'${folderId}' in parents and mimeType='${MIME_SPREADSHEET}' and trashed=false`;
  const res=await gapi.client.drive.files.list({ q, fields:'files(id,name)', pageSize:50, orderBy:'name_natural' });
  return res.result.files||[];
}
async function moveFileToFolder(fileId,targetFolderId,removeParents){
  await gapi.client.drive.files.update({ fileId, addParents:targetFolderId, removeParents:removeParents||'', fields:'id,parents' });
}
export async function findOrCreateSpreadsheetInSameFolder(glbFileId){
  const file=await getFile(glbFileId);
  const folderId=(file.parents&&file.parents[0])||null;
  if(!folderId) throw new Error('GLB has no parent folder');
  const cands=await listSpreadsheetsInFolder(folderId);
  if(cands.length) return cands[0].id;
  const title=`${file.name||'museum3d'}-pins`;
  const create=await gapi.client.sheets.spreadsheets.create({ properties:{ title } });
  const ssId=create.result.spreadsheetId;
  const meta=await gapi.client.drive.files.get({ fileId:ssId, fields:'id,parents' });
  const cur=(meta.result.parents||[]).join(',');
  await moveFileToFolder(ssId,folderId,cur);
  return ssId;
}