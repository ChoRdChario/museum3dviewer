import { getAccessToken, fetchDriveFileMetadata } from './utils_drive_api.js';
// utils_drive_images.js — list images in the same folder and HEIC conversion
import { driveGetFile } from './sheets_api.js?v=20251004s3';

export async function driveListImagesInSameFolder(glbFileId){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in');

  const glb = await driveGetFile(glbFileId);
  const folderId = (glb.parents && glb.parents[0]) || null;
  if (!folderId) return [];

  const q = encodeURIComponent(
    `('${folderId}' in parents) and (mimeType contains 'image/') and trashed=false`
  );
  const fields = encodeURIComponent('files(id,name,mimeType,thumbnailLink)');
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200`;
  const res = await fetch(url, { headers:{ 'Authorization': 'Bearer ' + access } });
  if (!res.ok){ throw new Error('drive list images failed ' + res.status); }
  const j = await res.json();
  return j.files || [];
}

export async function ensureHeic2Any(){
  if (window.heic2any) return;
  await new Promise((resolve, reject)=>{
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/heic2any/dist/heic2any.min.js';
    s.async = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

export async function downloadImageAsBlob(fileId){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in');
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType`, { headers:{ 'Authorization':'Bearer '+access } });
  if (!metaRes.ok) throw new Error('meta failed');
  const meta = await metaRes.json();
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, { headers:{ 'Authorization':'Bearer '+access } });
  if (!res.ok) throw new Error('download failed');
  const blob = await res.blob();
  if (/heic|heif/i.test(meta.mimeType)) {
    await ensureHeic2Any();
    const jpg = await window.heic2any({ blob, toType:'image/jpeg' });
    return jpg;
  }
  return blob;
}


export async function openDriveFolderOfFile(fileId){
  const token = getAccessToken();
  if (!token) throw new Error('[auth] No token');
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!metaRes.ok) throw new Error('[drive] parents failed ' + metaRes.status);
  const meta = await metaRes.json();
  const parent = (meta.parents && meta.parents[0]) || null;
  if (!parent) { alert('No parent folder found for this file.'); return; }
  const url = `https://drive.google.com/drive/folders/${parent}`;
  window.open(url, '_blank');
}
