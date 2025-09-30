// drive.js — ES5-safe + getFileId() hotfix
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){
    try { return gapi.client.getToken().access_token; } catch(e){ return null; }
  }

  // ---- NEW: extract fileId from various Drive share URLs or return as-is ----
  static getFileId(input){
    if(!input) return "";
    var s = (""+input).trim();

    // If it looks like a bare ID (no slashes, length ~ 20+), return as-is
    if(!/\//.test(s) && s.length >= 15 && !/^http/i.test(s)) return s;

    // Patterns:
    // 1) https://drive.google.com/file/d/<ID>/view?...
    var m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // 2) https://drive.google.com/open?id=<ID>
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // 3) https://drive.google.com/uc?id=<ID>
    m = s.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // 4) share URLs ending with .../view?resourcekey=...
    // already covered by (1), otherwise try last path segment heuristic
    try{
      var url = new URL(s);
      var segs = url.pathname.split('/').filter(Boolean);
      // Look for plausible id-looking segment
      for(var i=segs.length-1;i>=0;i--){
        if(/^[a-zA-Z0-9_-]{15,}$/.test(segs[i])) return segs[i];
      }
    }catch(_){}

    return s; // fallback: return original
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

  // file: Blob or File, name: string, folderId: string
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
