
export function normalizeDriveIdFromInput(s){
  if (!s) throw new Error('empty file id/url');
  const str = String(s).trim();
  const m = str.match(/[-\w]{20,}/);
  return m ? m[0] : str;
}
export async function fetchDriveFileAsArrayBuffer(id){
  const tok = (window.gapi && gapi.client.getToken && gapi.client.getToken()) || null;
  const access = tok && tok.access_token;
  if (!access) throw new Error('Not signed in. Click "Sign in" first.');
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  const res = await fetch(url, { method: 'GET', headers: { 'Authorization': `Bearer ${access}` } });
  if (!res.ok) {
    const text = await res.text().catch(()=>''); 
    throw new Error(`Drive download failed ${res.status}: ${text.slice(0,200)}`);
  }
  return await res.arrayBuffer();
}
