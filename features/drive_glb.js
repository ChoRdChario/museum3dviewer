// features/drive_glb.js (fallback minimal) — Drive から GLB を Blob で取得
export async function downloadGlbBlob(fileId){
  const res = await gapi.client.request({
    path: '/drive/v3/files/' + encodeURIComponent(fileId),
    method: 'GET',
    params: { alt: 'media' },
    responseType: 'arraybuffer'
  });
  if(res.status !== 200 && res.status !== 206){
    throw new Error('drive download failed: ' + res.status);
  }
  const buf = res.body;
  return new Blob([buf], { type: 'model/gltf-binary' });
}
