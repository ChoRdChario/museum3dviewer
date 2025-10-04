// utils_drive_api.js — Drive file helpers (auth download via Drive API)
/* global __GAUTH__ */
async function fetchDriveFileAsArrayBuffer(fileId){
  // normalize https://drive.google.com/file/d/<id>/... to id
  fileId = (fileId||"").trim();
  const m = fileId.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) fileId = m[1];
  if (!fileId) throw new Error("empty file id/url");
  const token = await (window.__GAUTH__?.getAccessToken?.());
  if (!token) throw new Error("no access token");
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {headers:{Authorization:`Bearer ${token}`}});
  if (!res.ok){
    const text = await res.text().catch(()=> "");
    throw new Error(`Drive API ${res.status}: ${text.slice(0,120)}`);
  }
  const buf = await res.arrayBuffer();
  return buf;
}
window.fetchDriveFileAsArrayBuffer = fetchDriveFileAsArrayBuffer;
