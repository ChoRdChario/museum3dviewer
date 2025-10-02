export async function downloadGlbBlob(fileId){
  if(!window.gapi?.client) throw new Error('gapi not ready');
  const token=gapi.client.getToken()?.access_token; if(!token) throw new Error('no OAuth token');
  const url=`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
  const res=await fetch(url,{ headers:{ 'Authorization':`Bearer ${token}` } });
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}
export async function getName(fileId){
  const meta=await gapi.client.drive.files.get({ fileId, fields:'name' });
  return meta.result?.name || 'model.glb';
}