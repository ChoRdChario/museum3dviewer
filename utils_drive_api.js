// utils_drive_api.js - robust token fallback (2025-10-07)

function getAccessToken(){
  // Prefer gapi client token if initialized, else fallback to GIS ACCESS_TOKEN
  const t = (window.gapi?.client?.getToken?.()?.access_token) || window.ACCESS_TOKEN || (window.gapi?.auth?.getToken?.()?.access_token);
  return t || null;
}

export async function fetchDriveFileAsArrayBuffer(fileId){
  const token = getAccessToken();
  if (!token) {
    throw new TypeError('[auth] No access token. Please sign in first.');
  }
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>''); 
    throw new Error(`[drive] fetch failed ${res.status} ${res.statusText} ${text}`);
  }
  return await res.arrayBuffer();
}

// Optional: simple metadata fetch (if your UI needs it)
export async function fetchDriveFileMetadata(fileId){
  const token = getAccessToken();
  if (!token) throw new TypeError('[auth] No access token.');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,size,mimeType`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`[drive] meta failed ${res.status} ${res.statusText}`);
  return await res.json();
}
