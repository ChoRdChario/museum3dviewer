
// features/drive.js  (v6.6.4-fix1)
import { toast } from './loading.js';
import { normalizeFileId } from './utils.js';

const DRIVE_FIELDS = 'id,name,mimeType,parents,md5Checksum,modifiedTime,owners,webViewLink,thumbnailLink,iconLink';

function qEscape(s){ return s.replace(/'/g, "\\'"); }
function withRetry(fn, tries=3, base=500){
  return new Promise(async (resolve, reject)=>{
    let last;
    for(let i=0;i<tries;i++){
      try{ const r = await fn(); return resolve(r); }
      catch(e){ last=e; await new Promise(r=>setTimeout(r, base*(i+1))); }
    }
    reject(last || new Error('retry failed'));
  });
}

export async function getFile(fileId){
  const fid = normalizeFileId(fileId);
  return withRetry(async ()=>{
    const res = await gapi.client.drive.files.get({ fileId: fid, fields: DRIVE_FIELDS, supportsAllDrives: true });
    return res.result;
  });
}

export async function getParents(fileId){
  const f = await getFile(fileId);
  return f.parents || [];
}

export async function listSiblingsImages(fileId){
  const parents = await getParents(fileId);
  if (!parents.length) return [];
  const parent = parents[0];
  const imgMimes = [
    "image/jpeg","image/png","image/gif","image/webp","image/heic","image/heif"
  ];
  const q = [
    `'${qEscape(parent)}' in parents`,
    '('+imgMimes.map(m=>`mimeType='${m}'`).join(' or ')+')',
    'trashed=false'
  ].join(' and ');
  const res = await withRetry(async ()=>{
    return await gapi.client.drive.files.list({
      q, fields: `files(${DRIVE_FIELDS}),nextPageToken`,
      pageSize: 1000, supportsAllDrives: true, includeItemsFromAllDrives: true
    });
  });
  return (res.result.files||[]).sort((a,b)=> (a.name||'').localeCompare(b.name||''));
}

export async function findSpreadsheetInSameFolder(fileId, baseNameHint){
  const parents = await getParents(fileId);
  if (!parents.length) return null;
  const parent = parents[0];
  const q = [
    `'${qEscape(parent)}' in parents`,
    `mimeType='application/vnd.google-apps.spreadsheet'`,
    'trashed=false'
  ].join(' and ');
  const res = await gapi.client.drive.files.list({
    q, fields: `files(${DRIVE_FIELDS})`, pageSize: 100, supportsAllDrives: true, includeItemsFromAllDrives: true
  });
  const files = res.result.files || [];
  if (!files.length) return null;
  if (baseNameHint){
    const f = files.find(f => (f.name||'').toLowerCase().includes(String(baseNameHint).toLowerCase()));
    if (f) return f;
  }
  return files[0];
}

export async function createSpreadsheet(fileId, title){
  const parents = await getParents(fileId);
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
    parents: parents.length ? [parents[0]] : undefined
  };
  const res = await gapi.client.drive.files.create({
    fields: DRIVE_FIELDS, supportsAllDrives: true, resource: metadata
  });
  toast.success('Spreadsheet created');
  return res.result;
}
