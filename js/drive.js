// drive.js — ES5-safe strings (no template literals) to avoid SyntaxError
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){
    try { return gapi.client.getToken().access_token; } catch(e){ return null; }
  }

  static async downloadFile(fileId){
    const token = Drive.token;
    const url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media";
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch(url, { headers });
    if(!r.ok) throw new Error("download failed");
    return await r.blob();
  }

  static async listImagesInFolder(folderId){
    const q = encodeURIComponent("'" + folderId + "' in parents and trashed = false and (mimeType contains 'image/')");
    const fields = encodeURIComponent("files(id,name,mimeType,thumbnailLink),nextPageToken");
    const token = Drive.token;
    const url = "https://www.googleapis.com/drive/v3/files?q=" + q +
      "&fields=" + fields +
      "&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true";
    const headers = token ? { Authorization: "Bearer " + token } : {};
    const r = await fetch(url, { headers });
    if(!r.ok) throw new Error("list images failed");
    const json = await r.json();
    const imgs = (json.files||[]).sort(function(a,b){
      function prio(m){ return /heic|heif/i.test(m) ? 2 : 0; }
      return prio(a.mimeType)-prio(b.mimeType) || a.name.localeCompare(b.name);
    });
    return imgs;
  }

  static async uploadToFolder(folderId, file, name){
    const token = Drive.token;
    if(!token) throw new Error("no token");
    const metadata = { name: name, parents: [folderId] };
    const boundary = "-------lmy" + Math.random().toString(16).slice(2);

    const part1 = "--" + boundary + "\r\n" +
                  "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                  JSON.stringify(metadata) + "\r\n";
    const part2Header = "--" + boundary + "\r\n" +
                  "Content-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n";
    const partEnd = "\r\n--" + boundary + "--";

    const body = new Blob([ part1, part2Header, file, partEnd ],
                          { type: "multipart/related; boundary=" + boundary });

    const url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    const r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: body
    });
    if(!r.ok){
      let t = "";
      try { t = await r.text(); } catch(_) {}
      throw new Error("upload failed: " + t);
    }
    return await r.json();
  }
}

window.drive = Drive;
