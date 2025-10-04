import { getAccessToken } from './gauth.js';

export function normalizeDriveIdFromInput(input){
  if (!input) return '';
  const m = String(input).match(/[?&]id=([a-zA-Z0-9_-]+)/) || String(input).match(/\/d\/(.+?)\//);
  if (m) return m[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(input)) return input;
  return '';
}

export async function fetchDriveFileAsArrayBuffer(fileId){
  const token = getAccessToken();
  if (!token) throw new Error('Not signed in');
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error('Drive fetch failed ' + res.status);
  return await res.arrayBuffer();
}
