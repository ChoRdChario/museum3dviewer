// utils_drive_api.js — export & global attach of Drive API download helper
/* global google */
async function getAccessToken(){
  // Prefer GAUTH if present
  if (window.__GAUTH__?.getAccessToken) return await window.__GAUTH__.getAccessToken();
  // Fallback: inline token client
  if (!window.google?.accounts?.oauth2) throw new Error("Google Identity Services not loaded");
  const CLIENT_ID = window.GAUTH_CLIENT_ID || "595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com";
  const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets";
  const token = await new Promise((resolve, reject)=>{
    const client = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID, scope: SCOPE, prompt: "", callback: resolve
    });
    client.requestAccessToken();
  });
  if (!token?.access_token) throw new Error("no token");
  return token.access_token;
}
export async function fetchDriveFileAsArrayBuffer(fileId){
  fileId = (fileId||"").trim();
  const m = fileId.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (m) fileId = m[1];
  if (!fileId) throw new Error("empty file id/url");
  const at = await getAccessToken();
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${at}` }});
  if (!res.ok){
    const text = await res.text().catch(()=> "");
    throw new Error(`Drive API ${res.status}: ${text.slice(0,160)}`);
  }
  return await res.arrayBuffer();
}
// also attach to window for legacy
window.fetchDriveFileAsArrayBuffer = fetchDriveFileAsArrayBuffer;
