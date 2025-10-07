\
// utils_drive_api.js - ES Module (2025-10-07)
// Provides: normalizeDriveIdFromInput, fetchDriveFileAsArrayBuffer, fetchDriveFileMetadata, getAccessToken

// --- Token helpers -----------------------------------------------------------
export function getAccessToken(){
  // Prefer gapi client token if initialized, else fallback to GIS ACCESS_TOKEN
  const t =
    (window.gapi?.client?.getToken?.()?.access_token) ||
    window.ACCESS_TOKEN ||
    (window.gapi?.auth?.getToken?.()?.access_token);
  return t || null;
}

// --- Drive ID normalization --------------------------------------------------
/**
 * Accepts:
 *  - Plain Drive file ID
 *  - https://drive.google.com/file/d/<id>/view?usp=share_link
 *  - https://drive.google.com/open?id=<id>
 *  - https://drive.google.com/uc?id=<id>&export=download
 *  - https://drive.usercontent.google.com/download?id=<id>&...
 *  - Any URL that contains '?id=<id>'
 *  - Leaves non-Drive strings alone (returns null) so caller can show a friendly error.
 */
export function normalizeDriveIdFromInput(input){
  if (!input) return null;
  const s = String(input).trim();
  // Quick accept if it looks like a bare ID
  const bare = /^[a-zA-Z0-9_-]{20,}$/; // Drive IDs are typically 25+ but allow >=20
  if (bare.test(s)) return s;

  try {
    const u = new URL(s);
    // 1) file/d/<id>/...
    let m = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m && m[1]) return m[1];
    // 2) /d/<id>/...
    m = u.pathname.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m && m[1]) return m[1];
    // 3) ?id=<id>
    const idParam = u.searchParams.get('id');
    if (idParam && /^[a-zA-Z0-9_-]{10,}$/.test(idParam)) return idParam;
  } catch (e) {
    // not a URL, continue
  }
  // 4) Fallback: loose capture anywhere in the string: id=<id>
  const loose = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (loose && loose[1]) return loose[1];

  return null;
}

// --- Drive fetchers ----------------------------------------------------------
export async function fetchDriveFileAsArrayBuffer(fileId){
  const token = getAccessToken();
  if (!token) {
    throw new TypeError('[auth] No access token. Please sign in first.');
  }
  const id = normalizeDriveIdFromInput(fileId) || fileId;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
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

export async function fetchDriveFileMetadata(fileId){
  const token = getAccessToken();
  if (!token) throw new TypeError('[auth] No access token.');
  const id = normalizeDriveIdFromInput(fileId) || fileId;
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,name,size,mimeType`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`[drive] meta failed ${res.status} ${res.statusText}`);
  return await res.json();
}
