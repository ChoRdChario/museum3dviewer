// utils_drive_api.js — Drive API download via OAuth token (CORS-safe)
//
// REQUIREMENTS:
// - User is signed in via GIS; gauth.js set token into gapi.client.
// - CLIENT_ID origins must include your GitHub Pages origin.
// - File must be readable by the signed-in user.
//
// USAGE: import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js'
//
export function normalizeDriveIdFromInput(s){
  if (!s) throw new Error('empty file id/url');
  const str = String(s).trim();
  // Support share URLs
  // - https://drive.google.com/file/d/<ID>/view?usp=sharing
  // - https://drive.google.com/open?id=<ID>
  // - https://drive.google.com/uc?id=<ID>&export=download
  const m = str.match(/[-\w]{20,}/);
  return m ? m[0] : str;
}

export async function fetchDriveFileAsArrayBuffer(id){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in. Click "Sign in" first.');

  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  const res = await fetch(url, {
    method: 'GET',
    headers: { 'Authorization': `Bearer ${access}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(()=>'');
    throw new Error(`Drive download failed ${res.status}: ${text.slice(0,200)}`);
  }
  return await res.arrayBuffer();
}
