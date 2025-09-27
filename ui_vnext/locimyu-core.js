/* Locimyu Core (UI-free) */
export class LocimyuCore extends EventTarget {
  constructor(opts={}){
    super();
    this.gapi = opts.gapi || (typeof window!=='undefined' ? window.gapi : null);
    this._fetch = opts.fetchImpl || (typeof fetch!=='undefined' ? fetch.bind(window) : null);
    this._glbFileId = null;
    this._glbObjectURL = null;
    this._sheetId = null;
    this._sheetTitle = null;
    this._lastAltMediaURL = null;
  }
  extractDriveFileId(input){
    if (!input) return null;
    var s = String(input);
    var m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/); if (m && m[1]) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/); if (m && m[1]) return m[1];
    m = s.match(/\/drive\/v3\/files\/([^\/?]+)\?[^#]*alt=media/i); if (m && m[1]) return decodeURIComponent(m[1]);
    if (/^[a-zA-Z0-9_-]{30,}$/.test(s)) return s;
    return null;
  }
  async loadGLBByFileId(fileId){
    if (!this.gapi || !this.gapi.client) throw new Error('gapi client not initialized');
    this._glbFileId = fileId;
    try{
      var meta = await this.gapi.client.drive.files.get({ fileId: fileId, fields: 'id,name,parents,mimeType,size,ownedByMe' });
      var parents = (meta && meta.result && meta.result.parents) || [];
      this.dispatchEvent(new CustomEvent('glb:meta', { detail: { fileId: fileId, parents: parents, name: meta.result && meta.result.name } }));
    }catch(_){}
    var path = '/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media';
    try{
      throw new Error('Switch to fetch path');
    }catch(_ignored){
      var token = null;
      try{ var auth = this.gapi.client.getToken && this.gapi.client.getToken(); token = auth && auth.access_token; }catch(_){}
      if (!this._fetch) throw new Error('fetch not available in this environment');
      var url = 'https://www.googleapis.com'+path;
      var r = await this._fetch(url, { headers: token ? { 'Authorization': 'Bearer '+token } : {} });
      if (!r.ok){
        var txt = await r.text().catch(function(){ return String(r.statusText||''); });
        throw new Error('GLB download failed: ' + r.status + ' ' + txt + '\\n\\nIDが正しいか確認してください。共有URLのコピペ、または30文字以上の完全なFileIdを貼り付けてください。');
      }
      var blob = await r.blob();
      if (this._glbObjectURL) try{ URL.revokeObjectURL(this._glbObjectURL); }catch(_){}
      this._glbObjectURL = URL.createObjectURL(blob);
      this._lastAltMediaURL = url;
      this.dispatchEvent(new CustomEvent('glb:url', { detail: { fileId: fileId, objectUrl: this._glbObjectURL } }));
    }
  }
  async loadGLB(input){
    var id = this.extractDriveFileId(input);
    if (!id) throw new Error('Drive fileId もしくは共有URLを指定してください。');
    return this.loadGLBByFileId(id);
  }
  async resolvePinSpreadsheet(fileId){
    var fid = fileId || this._glbFileId;
    if (!fid) return null;
    if (!this.gapi || !this.gapi.client || !this.gapi.client.drive) throw new Error('Drive API is not ready');
    var meta = await this.gapi.client.drive.files.get({ fileId: fid, fields: 'parents' });
    var parents = (meta.result && meta.result.parents) || [];
    var parent = parents[0];
    if (!parent) return null;
    var q1 = ["'"+parent+"' in parents","mimeType='application/vnd.google-apps.spreadsheet'","trashed=false","appProperties has { key='lociFor' and value='"+fid+"' }"].join(' and ');
    var list = await this.gapi.client.drive.files.list({
      q: q1, pageSize: 10, fields: 'files(id,name)', includeItemsFromAllDrives: true, supportsAllDrives: true
    });
    var files = (list.result && list.result.files) || [];
    if (!files.length){
      var q2 = ["'"+parent+"' in parents","mimeType='application/vnd.google-apps.spreadsheet'","trashed=false"].join(' and ');
      list = await this.gapi.client.drive.files.list({
        q: q2, pageSize: 10, fields: 'files(id,name)', includeItemsFromAllDrives: true, supportsAllDrives: true
      });
      files = (list.result && list.result.files) || [];
    }
    if (!files.length) return null;
    this._sheetId = files[0].id;
    this._sheetTitle = files[0].name;
    this.dispatchEvent(new CustomEvent('sheet:resolved', { detail: { sheetId: this._sheetId, name: this._sheetTitle } }));
    return { sheetId: this._sheetId, name: this._sheetTitle };
  }
  async loadPins(sheetId){
    var sid = sheetId || this._sheetId;
    if (!sid) throw new Error('sheetId is required');
    var rows = null;
    try{
      if (!this.gapi.client.sheets) await this.gapi.client.load('sheets', 'v4');
      var meta = await this.gapi.client.sheets.spreadsheets.get({ spreadsheetId: sid });
      var firstTitle = (meta.result && meta.result.sheets && meta.result.sheets[0] &&
                        meta.result.sheets[0].properties && meta.result.sheets[0].properties.title) || 'Sheet1';
      var vals = await this.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sid, range: firstTitle+'!A:Z' });
      rows = (vals.result && vals.result.values) || [];
    }catch(e){
      try{
        var res = await this.gapi.client.request({
          path: '/drive/v3/files/'+encodeURIComponent(sid)+'/export',
          method: 'GET',
          params: { mimeType: 'text/csv' }
        });
        var csv = (res.body || res.result || '')+'';
        rows = this._parseCSV(csv);
      }catch(e2){
        var msg = (e && e.result && e.result.error && e.result.error.message) ? e.result.error.message : (e && e.message ? e.message : String(e));
        var msg2 = (e2 && e2.result && e2.result.error && e2.result.error.message) ? e2.result.error.message : (e2 && e2.message ? e2.message : String(e2));
        var err = new Error('Pin sheet load failed.\\nSheetsAPI: '+msg+'\\nDriveCSV: '+msg2);
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
        throw err;
      }
    }
    var pins = this._rowsToPins(rows);
    this.dispatchEvent(new CustomEvent('pins:loaded', { detail: { pins: pins, sheetId: sid } }));
    return pins;
  }
  _parseCSV(csv){
    var rows=[], row=[], cell='', q=false;
    for (var i=0;i<csv.length;i++){
      var ch = csv[i];
      if (q){
        if (ch === '"'){
          if (i+1<csv.length && csv[i+1] === '"'){ cell+='"'; i++; }
          else { q = false; }
        }else{ cell += ch; }
      }else{
        if (ch === '"'){ q = true; }
        else if (ch === ','){ row.push(cell); cell=''; }
        else if (ch === '\\n' || ch === '\\r'){
          if (ch === '\\r' && i+1<csv.length && csv[i+1] === '\\n') i++;
          row.push(cell); rows.push(row); row=[]; cell='';
        }else{ cell += ch; }
      }
    }
    if (cell.length>0 || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }
  _rowsToPins(rows){
    if (!rows || !rows.length) return [];
    var header = rows[0].map(x=>String(x||'').trim().toLowerCase());
    function H(names){ for (var i=0;i<names.length;i++){ var j = header.indexOf(names[i]); if (j>=0) return j; } return -1; }
    var c_id    = H(['id','pinid','key','番号','no','ＩＤ']);
    var c_title = H(['title','name','captiontitle','タイトル','名称','題名','見出し']);
    var c_body  = H(['body','note','caption','description','本文','説明','メモ']);
    var c_img   = H(['img','image','photourl','thumbnail','画像','写真url','写真','サムネイル']);
    var out = [];
    for (var i=1;i<rows.length;i++){
      var r = rows[i] || []; var o = {_row: i+1};
      o.id    = (c_id>=0    ? r[c_id]    : '') || o._row;
      o.title = (c_title>=0 ? r[c_title] : '') || '';
      o.body  = (c_body>=0  ? r[c_body]  : '') || '';
      o.img   = (c_img>=0   ? r[c_img]   : '') || '';
      out.push(o);
    }
    return out;
  }
}
