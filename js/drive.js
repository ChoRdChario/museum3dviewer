export class Drive {
  async getFileId(input){
    if(!input) return null;
    // Accept fileId || various Drive share URL patterns
    try{
      const url = new URL(input);
      // Patterns: /file/d/<id>/, id=, open?id=, uc?id=
      const m = url.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
      if(m) return m[1];
      const id = url.searchParams.get('id');
      if(id) return id;
      // also try "folders/..." then not a file
    }catch(e){ /* plain string */ }
    return input; // assume it's a fileId
  }

  async getFileMeta(fileId){
    const res = await gapi.client.drive.files.get({
      fileId, fields: 'id,name,mimeType,parents,webViewLink',
      supportsAllDrives: true,
    });
    return res.result;
  }

  async listImagesInFolder(folderId){
    // We need to include HEIC/HEIF even when mimeType is not strictly image/*
    const q = `'${folderId}' in parents and trashed = false`;
    const res = await gapi.client.drive.files.list({
      q, fields: 'files(id,name,mimeType)', pageSize: 1000,
      supportsAllDrives: true, includeItemsFromAllDrives: true,
    });
    const files = res.result.files || [];
    const ok = (f)=>{
      const mt = (f.mimeType||'').toLowerCase();
      const nm = (f.name||'').toLowerCase();
      if(mt.startsWith('image/')) return true;
      if(nm.endsWith('.heic') || nm.endsWith('.heif')) return true
      return false;
    };
    return files.filter(ok);
  }

  async downloadFile(fileId){
    const res = await gapi.client.drive.files.get({
      fileId, alt: 'media'
    });
    // gapi returns body as string; use fetch via webContentLink? Not available without enabling.
    // Workaround: Use XHR with access token
    const token = gapi.client.getToken()?.access_token;
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if(!r.ok) throw new Error('download failed');
    return await r.arrayBuffer();
  }

  async uploadToFolder(folderId, blob, name, mimeType){
    const token = gapi.client.getToken()?.access_token;
    const metadata = { name, parents: [folderId], mimeType };
    const boundary = '-------314159265358979323846';
    const delimiter = `\r\n--${boundary}\r\n`;
    const closeDelim = `\r\n--${boundary}--`;
    const base64Data = await new Response(blob).arrayBuffer().then(buf=> btoa(String.fromCharCode(...new Uint8Array(buf))));
    const body =
      delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify(metadata) +
      delimiter + `Content-Type: ${mimeType}\r\n` +
      'Content-Transfer-Encoding: base64\r\n\r\n' +
      base64Data + closeDelim;
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': `multipart/related; boundary="${boundary}"`
      },
      body
    });
    if(!res.ok) throw new Error('upload failed');
    return await res.json();
  }

  async findOrCreateSpreadsheetInSameFolder(fileMeta, titleSuffix="__LociMyu"){
    const folderId = (fileMeta.parents && fileMeta.parents[0]) || null;
    if(!folderId) throw new Error('Parent folder not found');
    // Search spreadsheet by name pattern "<basename>__LociMyu"
    const base = (fileMeta.name || 'model').replace(/\.glb$|\.gltf$/i, '');
    const targetName = base + titleSuffix;
    const q = `'${folderId}' in parents and mimeType = 'application/vnd.google-apps.spreadsheet' and name = '${targetName}' and trashed = false`;
    const res = await gapi.client.drive.files.list({
      q, fields: 'files(id,name)', pageSize: 10, supportsAllDrives:true, includeItemsFromAllDrives:true
    });
    const found = (res.result.files||[])[0];
    if(found) return found;

    // Create new spreadsheet in folder
    const ss = await gapi.client.sheets.spreadsheets.create({
      resource: { properties: { title: targetName } }
    });
    const ssId = ss.result.spreadsheetId;
    // Move to folder
    await gapi.client.drive.files.update({
      fileId: ssId,
      addParents: folderId,
      fields: 'id, parents',
    });
    return { id: ssId, name: targetName };
  }
}
