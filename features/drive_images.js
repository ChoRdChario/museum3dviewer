// features/drive_images.js
// List images in the same folder as the GLB and provide a downloader
// that converts HEIC/HEIF to JPEG when needed.

const LOG = (...a)=>console.log('[drive]', ...a);
const WARN = (...a)=>console.warn('[drive]', ...a);

// List sibling images under the given folderId
export async function listSiblingImages(folderId){
  const q = [
    `'${folderId}' in parents`,
    "mimeType contains 'image/'",
    'trashed = false'
  ].join(' and ');

  const res = await gapi.client.drive.files.list({
    q, fields: 'files(id,name,mimeType,thumbnailLink,webViewLink,createdTime,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: 200,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true
  });
  const items = res.result.files || [];
  LOG('found', items.length, 'images');
  return items;
}

// Download image and return a Browser ObjectURL (string).
// If HEIC/HEIF, attempt convert to JPEG using heic2any.
export async function downloadImageBlobIfNeeded(fileId){
  // Drive v3: responseType 'blob'
  const resp = await gapi.client.drive.files.get({ fileId, alt:'media' });
  // gapi doesn't expose responseType switch; in many bundlers you use XHR/fetch.
  // Fallback: use fetch with Drive download URL (requires token).
  let blob;
  try{
    blob = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { 'Authorization': `Bearer ${gapi.client.getToken().access_token}` }
    }).then(r=>{ if(!r.ok) throw new Error('fetch failed'); return r.blob(); });
  }catch(e){
    WARN('fetch blob failed, fallback via gapi xhr likely missing'); throw e;
  }

  const isHeic = /^image\/hei(c|f)/i.test(blob.type) || /\.(heic|heif)$/i.test(fileId);
  if(isHeic){
    try{
      if(window.__LMY_ensureHeic2Any) await window.__LMY_ensureHeic2Any();
      const out = await window.heic2any({ blob, toType:'image/jpeg' });
      blob = out instanceof Blob ? out : (Array.isArray(out)? out[0] : blob);
    }catch(e){ WARN('heic convert failed', e); }
  }
  const url = URL.createObjectURL(blob);
  return url;
}
