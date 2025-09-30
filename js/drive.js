// drive.js — Phase1e hotfix: listImagesInFolder + safe uploadToFolder
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){ try{ return gapi.client.getToken().access_token; }catch(e){ return null; } }

  static async downloadFile(fileId){
    const token = Drive.token;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: token ? { Authorization:`Bearer ${token}` } : {}
    });
    if(!r.ok) throw new Error('download failed');
    return await r.blob();
  }

  static async listImagesInFolder(folderId){
    const q = encodeURIComponent(`'${folderId}' in parents and trashed = false and (mimeType contains 'image/')`);
    const fields = encodeURIComponent('files(id,name,mimeType,thumbnailLink),nextPageToken');
    const token = Drive.token;
    const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true`;
    const r = await fetch(url, { headers: token ? { Authorization:`Bearer ${token}` } : {} });
    if(!r.ok) throw new Error('list images failed');
    const json = await r.json();
    const imgs = (json.files||[]).sort((a,b)=>{
      const prio = (m)=>(/heic|heif/i.test(m)?2:0);
      return prio(a.mimeType)-prio(b.mimeType) || a.name.localeCompare(b.name);
    });
    return imgs;
  }

  // file: Blob or File, name: string, folderId: string
  static async uploadToFolder(folderId, file, name){
    const token = Drive.token;
    if(!token) throw new Error('no token');
    const metadata = { name, parents: [folderId] };
    const boundary = '-------lmy' + Math.random().toString(16).slice(2);
    const body = new Blob([
      `--${boundary}
`,
      'Content-Type: application/json; charset=UTF-8

',
      JSON.stringify(metadata), '
',
      `--${boundary}
`,
      `Content-Type: ${file.type || 'application/octet-stream'}

`,
      file, '
',
      `--${boundary}--`
    ], {type:`multipart/related; boundary=${boundary}`});

    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true', {
      method:'POST',
      headers:{ Authorization:`Bearer ${token}` },
      body
    });
    if(!r.ok){ const t = await r.text().catch(()=> ''); throw new Error('upload failed: '+t); }
    return await r.json();
  }
}

window.drive = Drive;
