export async function downloadGlbBlob(fileId){
  if (!window.gapi?.client) throw new Error('gapi not ready');
  const res = await gapi.client.drive.files.get({ fileId, alt: 'media' });
  const blob = new Blob([res.body], { type: 'model/gltf-binary' });
  return blob;
}
export async function getName(fileId){
  const meta = await gapi.client.drive.files.get({ fileId, fields: 'name' });
  return meta.result?.name || 'model.glb';
}
