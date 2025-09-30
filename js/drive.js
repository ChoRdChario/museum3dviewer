// drive.js — adds findOrCreateSpreadsheetInSameFolder (ES5-safe) + instance aliases
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){
    try { return gapi.client.getToken().access_token; } catch(e){ return null; }
  }

  // Extract Drive fileId from URL or return as-is
  static getFileId(input){
    if(!input) return "";
    var s = (""+input).trim();
    if(s && !/\//.test(s) && s.length >= 15 && !/^http/i.test(s)) return s;
    var m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    m = s.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    try{
      var url = new URL(s);
      var segs = url.pathname.split('/').filter(function(x){ return !!x; });
      for(var i=segs.length-1;i>=0;i--){
        if(/^[a-zA-Z0-9_-]{15,}$/.test(segs[i])) return segs[i];
      }
    }catch(_){}
    return s;
  }

  // Fetch file metadata (id,name,mimeType,parents,...)
  static async getFileMeta(fileId){
    var token = Drive.token; if(!token) throw new Error("no token");
    var fields = "id,name,mimeType,parents,size,modifiedTime,iconLink,webViewLink";
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) +
              "?fields=" + encodeURIComponent(fields) + "&supportsAllDrives=true";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if(!r.ok){ var t=""; try{ t=await r.text(); }catch(_){}; throw new Error("get meta failed: " + t); }
    return await r.json();
  }

  // Download file as Blob (with HTML detection)
  static async downloadFile(fileId){
    var token = Drive.token;
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media";
    var headers = token ? { Authorization: "Bearer " + token } : {};
    var r = await fetch(url, { headers: headers });
    if(!r.ok){ var t=""; try{ t=await r.text(); }catch(_){}; throw new Error("download failed: " + t); }
    // Basic HTML guard (Drive preview/permission error)
    try{
      var clone = r.clone();
      var ab = await clone.arrayBuffer();
      var u8 = new Uint8Array(ab, 0, Math.min(96, ab.byteLength));
      var head = ""; try{ head = new TextDecoder().decode(u8).replace(/^\s+/, ""); }catch(_){}
      if (/^<!DOCTYPE|^<html|^<HTML/.test(head)) throw new Error("DriveからHTMLが返却されました。共有設定/権限/URLを確認してください。");
    }catch(e){
      if (String(e && e.message||e).indexOf("DriveからHTMLが返却")>=0) throw e;
    }
    return await r.blob();
  }

  // List images in a folder (for thumbnail grid)
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

  // Upload (multipart/related) without base64 strings
  static async uploadToFolder(folderId, file, name){
    var token = Drive.token; if(!token) throw new Error("no token");
    var metadata = { name: name, parents: [folderId] };
    var boundary = "-------lmy" + Math.random().toString(16).slice(2);
    var part1 = "--" + boundary + "\r\n" +
                "Content-Type: application/json; charset=UTF-8\r\n\r\n" +
                JSON.stringify(metadata) + "\r\n";
    var part2Header = "--" + boundary + "\r\n" +
                "Content-Type: " + (file.type || "application/octet-stream") + "\r\n\r\n";
    var partEnd = "\r\n--" + boundary + "--";
    function crlf(s){ return s.replace(/\\r\\n/g, "\r\n"); }
    var body = new Blob([ crlf(part1), crlf(part2Header), file, crlf(partEnd) ],
                        { type: "multipart/related; boundary=" + boundary });
    var url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    var r = await fetch(url, { method:"POST", headers:{ Authorization:"Bearer " + token }, body:body });
    if(!r.ok){ var t=""; try{ t=await r.text(); }catch(_){}; throw new Error("upload failed: " + t); }
    return await r.json();
  }

  // NEW: find or create a Google Sheet in the same folder as the model file
  // Accepts: fileId (string) or meta object {id, parents, name}
  // Returns: file meta {id,name,mimeType,parents}
  static async findOrCreateSpreadsheetInSameFolder(fileIdOrMeta){
    var token = Drive.token; if(!token) throw new Error("no token");
    var meta = null;
    if (fileIdOrMeta && typeof fileIdOrMeta === "object" && fileIdOrMeta.id) {
      meta = fileIdOrMeta;
    } else {
      var fid = Drive.getFileId(fileIdOrMeta);
      meta = await Drive.getFileMeta(fid);
    }
    if (!meta || !meta.parents || !meta.parents.length) throw new Error("parent folder not found");
    var folderId = meta.parents[0];
    var base = (meta.name||"").replace(/\.[^\.]+$/, ""); // strip extension

    // 1) search spreadsheets in the same folder
    var q = "'" + folderId + "' in parents and trashed = false and mimeType = 'application/vnd.google-apps.spreadsheet'";
    var url = "https://www.googleapis.com/drive/v3/files?q=" + encodeURIComponent(q) +
              "&fields=" + encodeURIComponent("files(id,name,mimeType,parents)") +
              "&pageSize=100&orderBy=name&supportsAllDrives=true&includeItemsFromAllDrives=true";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if(!r.ok){ var t=""; try{ t=await r.text(); }catch(_){}; throw new Error("search failed: " + t); }
    var json = await r.json();
    var files = json.files || [];

    // prefer: name contains 'LociMyu' or contains base name
    var pick = null;
    for (var i=0;i<files.length;i++){
      var nm = files[i].name || "";
      if (/(^|\s)-?\s*LociMyu(\s|$)/i.test(nm)) { pick = files[i]; break; }
    }
    if (!pick && base){
      for (var j=0;j<files.length;j++){
        var nm2 = files[j].name || "";
        if (nm2.toLowerCase().indexOf(base.toLowerCase()) >= 0){ pick = files[j]; break; }
      }
    }
    if (!pick && files.length) pick = files[0];

    // 2) create if none
    if (!pick){
      var name = (base ? (base + " - LociMyu") : "LociMyu");
      var createMeta = {
        name: name,
        mimeType: "application/vnd.google-apps.spreadsheet",
        parents: [folderId]
      };
      var cr = await fetch("https://www.googleapis.com/drive/v3/files", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json; charset=UTF-8"
        },
        body: JSON.stringify(createMeta)
      });
      if (!cr.ok){ var te=""; try{ te=await cr.text(); }catch(_){}; throw new Error("create spreadsheet failed: " + te); }
      pick = await cr.json();
      // normalize fields
      pick.mimeType = "application/vnd.google-apps.spreadsheet";
      pick.parents = [folderId];
    }

    return pick;
  }
}

// Instance aliases
Drive.prototype.getFileId = function(input){ return Drive.getFileId(input); };
Drive.prototype.getFileMeta = function(fileId){ return Drive.getFileMeta(fileId); };
Drive.prototype.downloadFile = function(fileId){ return Drive.downloadFile(fileId); };
Drive.prototype.listImagesInFolder = function(folderId){ return Drive.listImagesInFolder(folderId); };
Drive.prototype.uploadToFolder = function(folderId, file, name){ return Drive.uploadToFolder(folderId, file, name); };
Drive.prototype.findOrCreateSpreadsheetInSameFolder = function(x){ return Drive.findOrCreateSpreadsheetInSameFolder(x); };

if (typeof window !== "undefined" && !window.drive) window.drive = Drive;
