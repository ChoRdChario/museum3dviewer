// features/drive_ctx.js
export async function ensureAuth() {
  if (!(window.gapi && window.gapi.client && window.gapi.client.getToken && window.gapi.client.getToken())) {
    throw new Error('no OAuth token');
  }
}
export async function getParentFolderId(fileId) {
  await ensureAuth();
  const res = await gapi.client.drive.files.get({ fileId, fields: 'parents' });
  const parents = res?.result?.parents || [];
  if (!parents.length) throw new Error('parent folder not found');
  return parents[0];
}
export async function listSiblingImages(folderId) {
  await ensureAuth();
  const q = `'${folderId}' in parents and trashed=false and mimeType contains 'image/'`;
  const res = await gapi.client.drive.files.list({
    q, fields: 'files(id,name,mimeType,thumbnailLink,modifiedTime)', pageSize: 500
  });
  return res.result.files || [];
}
export async function downloadFileBlob(fileId) {
  await ensureAuth();
  const meta = await gapi.client.drive.files.get({ fileId, fields: 'id,name,webContentLink' });
  if (meta?.result?.webContentLink) {
    const r = await fetch(meta.result.webContentLink);
    if (!r.ok) throw new Error('blob fetch failed ' + r.status);
    return await r.blob();
  }
  // Fallback to media
  const res = await gapi.client.drive.files.get({ fileId, alt: 'media' });
  const body = res.body || res.result || res;
  if (body instanceof Blob) return body;
  throw new Error('blob download failed');
}
