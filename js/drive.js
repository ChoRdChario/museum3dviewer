// drive.js — ES5-safe + getFileId/getFileMeta (both static & instance aliases)
// Provides: getFileId, getFileMeta, downloadFile, listImagesInFolder, uploadToFolder
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){
    try { return gapi.client.getToken().access_token; } catch(e){ return null; }
  }

  // ---- Extract fileId from various Drive share URLs or return as-is ----
  static getFileId(input){
    if(!input) return "";
    var s = (""+input).trim();

    // Bare ID (no slash, long-ish, not http)
    if(s && !/\//.test(s) && s.length >= 15 && !/^http/i.test(s)) return s;

    // /file/d/<ID>/...
    var m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // ?id=<ID>
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // /uc?id=<ID>
    m = s.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/);
    if(m && m[1]) return m[1];

    // Fallback: last plausible path segment
    try{
      var url = new URL(s);
      var segs = url.pathname.split('/').filter(function(x){ return !!x; });
      for(var i=segs.length-1;i>=0;i--){
        if(/^[a-zA-Z0-9_-]{15,}$/.test(segs[i])) return segs[i];
      }
    }catch(_){}

    return s;
  }

  // ---- Get file metadata (name/mimeType/parents/etc.) ----
  static async getFileMeta(fileId){
    var token = Drive.token;
    if(!token) throw new Error("no token");
    var fields = "id,name,mimeType,parents,owners(displayName,emailAddress),size,modifiedTime,iconLink,webViewLink";
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) +
              "?fields=" + encodeURIComponent(fields) +
              "&supportsAllDrives=true";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if(!r.ok){
      var t = ""; try{ t = await r.text(); }catch(_){}
      throw new Error("get meta failed: " + t);
    }
    return await r.json();
  }

  // ---- File download as Blob ----
  static async downloadFile(fileId){
    var token = Drive.token;
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media";
    var headers = token ? { Authorization: "Bearer " + token } : {};
    var r = await fetch(url, { headers: headers });
    if(!r.ok) throw new Error("download failed");
    return await r.blob();
  }

  // ---- List images in a folder (for thumbnail rail) ----
  static async listImagesInFolder(folderId){
    var q = encodeURIComponent("'" + folderId + "' in parents and trashed = false and (mimeType contains 'image/')");
    var fields = encodeURIComponent("files(id,name,mimeType,thumbnailLink),nextPageToken");
    var token = Drive.token;
    var url = "https://www.googleapis.com/drive/v3/files?q=" + q +
      "&fields=" + fields +
      "&pageSize=200&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true";
    var headers = token ? { Authorization: "Bearer " + token } : {};
    var r = await fetch(url, { headers: headers });
    if(!r.ok) throw new Error("list images failed");
    var json = await r.json();
    var imgs = (json.files||[]).sort(function(a,b){
      function prio(m){ return /heic|heif/i.test(m) ? 2 : 0; }
      var d = prio(a.mimeType)-prio(b.mimeType);
      return d !== 0 ? d : a.name.localeCompare(b.name);
    });
    return imgs;
  }

  // ---- Upload (multipart/related) without base64 strings ----
  // file: Blob or File, name: string, folderId: string
  static async uploadToFolder(folderId, file, name){
    var token = Drive.token;
    if(!token) throw new Error("no token");
    var metadata = { name: name, parents: [folderId] };
    var boundary = "-------lmy" + Math.random().toString(16).slice(2);

    var part1 = "--" + boundary + "\r\n" +
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) + "\r\n";
    var part2Header = "--" + boundary + "\r\n" +
                "Content-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n";
    var partEnd = "\r\n--" + boundary + "--";

    function crlf(s){ return s.replace(/\\r\\n/g, "\r\n"); }

    var body = new Blob([
      crlf(part1),
      crlf(part2Header),
      file,
      crlf(partEnd)
    ], { type: "multipart/related; boundary=" + boundary });

    var url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    var r = await fetch(url, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: body
    });
    if(!r.ok){
      var t = "";
      try { t = await r.text(); } catch(_) {}
      throw new Error("upload failed: " + t);
    }
    return await r.json();
  }
}

// ---- Instance aliases for static helpers ----
Drive.prototype.getFileId = function(input){ return Drive.getFileId(input); };
Drive.prototype.getFileMeta = function(fileId){ return Drive.getFileMeta(fileId); };

// Keep class on window for code that expects window.drive to exist (class-level)
window.drive = Drive;
