// drive.js — Phase1f: ES5-safe + instance aliases + HTML detection in downloadFile
export class Drive {
  constructor(gapi){ this.gapi = gapi; }
  static get token(){ try { return gapi.client.getToken().access_token; } catch(e){ return null; } }

  static getFileId(input){
    if(!input) return "";
    var s = (""+input).trim();
    if(s && !/\/.*/.test(s) && s.length >= 15 && !/^http/i.test(s)) return s;
    var m = s.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    m = s.match(/drive\.google\.com\/uc\?id=([a-zA-Z0-9_-]+)/); if(m && m[1]) return m[1];
    try{
      var url = new URL(s), segs = url.pathname.split('/').filter(function(x){ return !!x; });
      for(var i=segs.length-1;i>=0;i--) if(/^[a-zA-Z0-9_-]{15,}$/.test(segs[i])) return segs[i];
    }catch(_){}
    return s;
  }

  static async getFileMeta(fileId){
    var token = Drive.token; if(!token) throw new Error("no token");
    var fields = "id,name,mimeType,parents,size,modifiedTime,iconLink,webViewLink";
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) +
              "?fields=" + encodeURIComponent(fields) + "&supportsAllDrives=true";
    var r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if(!r.ok){ var t=""; try{t=await r.text();}catch(_){}
      throw new Error("get meta failed: "+t); }
    return await r.json();
  }

  static async downloadFile(fileId){
    var token = Drive.token;
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "?alt=media";
    var headers = token ? { Authorization: "Bearer " + token } : {};
    var r = await fetch(url, { headers: headers });
    if(!r.ok){
      var txt=""; try{ txt = await r.text(); }catch(_){}
      throw new Error("download failed: " + txt);
    }
    // HTML detection
    try{
      var clone = r.clone();
      var ab = await clone.arrayBuffer();
      var u8 = new Uint8Array(ab, 0, Math.min(80, ab.byteLength));
      var head = ""; try{ head = new TextDecoder().decode(u8).replace(/^\s+/, ""); }catch(_){}
      if (/^<!DOCTYPE|^<html|^<HTML/.test(head)){
        throw new Error("DriveからHTMLが返却されました。共有設定/権限/URL形式（file/d/<id>/view）を確認してください。");
      }
    }catch(e){
      if (String(e && e.message||e).indexOf('DriveからHTMLが返却')>=0) throw e;
      // swallow pre-scan errors; continue to blob
    }
    return await r.blob();
  }

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
    var body = new Blob([ part1, part2Header, file, partEnd ],
                        { type: "multipart/related; boundary=" + boundary });
    var url = "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true";
    var r = await fetch(url, { method:"POST", headers:{ Authorization:"Bearer " + token }, body:body });
    if(!r.ok){ var t=""; try{t=await r.text();}catch(_){}
      throw new Error("upload failed: " + t); }
    return await r.json();
  }
}

// Instance aliases
Drive.prototype.getFileId = function(input){ return Drive.getFileId(input); };
Drive.prototype.getFileMeta = function(fileId){ return Drive.getFileMeta(fileId); };
Drive.prototype.downloadFile = function(fileId){ return Drive.downloadFile(fileId); };
Drive.prototype.listImagesInFolder = function(folderId){ return Drive.listImagesInFolder(folderId); };
Drive.prototype.uploadToFolder = function(folderId, file, name){ return Drive.uploadToFolder(folderId, file, name); };

if (typeof window !== "undefined" && !window.drive) window.drive = Drive;
