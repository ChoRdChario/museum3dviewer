import { getAccessToken } from './gauth.js';

export async function listSiblingImages(fileId){
  const token = getAccessToken();
  if (!token) return [];
  // 1) get parents
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!metaRes.ok) return [];
  const meta = await metaRes.json();
  const parent = (meta.parents||[])[0];
  if (!parent) return [];
  // 2) list images in folder
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/')`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=1000`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) return [];
  const json = await res.json();
  return json.files||[];
}
