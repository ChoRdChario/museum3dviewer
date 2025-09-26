/* Locimyu Core (UI-free)
   Purpose: decouple Drive/Sheets I/O and pin/material parsing from any UI.
   - No DOM access, no CSS, no event listeners on UI elements.
   - Exposes an EventTarget-based API.
   - Works with Google API Client (gapi) and OAuth access token.
*/

export class LocimyuCore extends EventTarget {
  /**
   * @param {{ gapi?: any, fetchImpl?: (input:RequestInfo, init?:RequestInit)=>Promise<Response> }} opts
   */
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

  /** Utilities **/
  /**
   * Extract a Drive fileId from:
   *  - share URL e.g. https://drive.google.com/file/d/FILEID/view?usp=...
   *  - /open?id=FILEID
   *  - direct id string (>=30 chars)
   *  - alt=media URL recorded by fetch hooks
   * @param {string} input
   * @returns {string|null}
   */
  extractDriveFileId(input){
    if (!input) return null;
    var s = String(input);
    // /file/d/ID
    var m = s.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m && m[1]) return m[1];
    // ?id=ID
    m = s.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
    if (m && m[1]) return m[1];
    // /drive/v3/files/ID?alt=media
    m = s.match(/\/drive\/v3\/files\/([^/?]+)\?[^#]*alt=media/i);
    if (m && m[1]) return decodeURIComponent(m[1]);
    // ID only (strict, 30+ chars to avoid false positives)
    if (/^[a-zA-Z0-9_-]{30,}$/.test(s)) return s;
    return null;
  }

  /** Google API init helpers (optional) **/
  /**
   * Initialize gapi client. You can also do this outside and just set this.gapi.
   * @param {{apiKey:string, clientId:string, scopes:string[], discoveryDocs:string[]}} cfg
   */
  async initGapi(cfg){
    if (!this.gapi || !this.gapi.load) throw new Error('gapi not available');
    await new Promise((resolve, reject)=>{
      try{ this.gapi.load('client', {callback: resolve, onerror: reject}); }catch(e){ reject(e); }
    });
    await this.gapi.client.init({
      apiKey: cfg.apiKey,
      clientId: cfg.clientId,
      scope: (cfg.scopes||[]).join(' '),
      discoveryDocs: cfg.discoveryDocs || [
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        'https://sheets.googleapis.com/$discovery/rest?version=v4'
      ]
    });
    this.dispatchEvent(new CustomEvent('auth:ready'));
  }

  /** Core: GLB **/
  /**
   * Fetch a GLB by Drive fileId (OAuth Bearer). Emits:
   *  - 'glb:meta' {fileId, parents: string[]}
   *  - 'glb:url'  {fileId, objectUrl}
   *  - 'error' on failure
   * @param {string} fileId
   */
  async loadGLBByFileId(fileId){
    if (!this.gapi || !this.gapi.client) throw new Error('gapi client not initialized');
    this._glbFileId = fileId;

    // metadata (non-fatal)
    try{
      var meta = await this.gapi.client.drive.files.get({ fileId: fileId, fields: 'id,name,parents,mimeType,size,ownedByMe' });
      var parents = (meta && meta.result && meta.result.parents) || [];
      this.dispatchEvent(new CustomEvent('glb:meta', { detail: { fileId: fileId, parents: parents, name: meta.result && meta.result.name } }));
    }catch(_){ /* non-fatal */ }

    // GLB download (alt=media)
    var path = '/drive/v3/files/'+encodeURIComponent(fileId)+'?alt=media';
    try{
      var res = await this.gapi.client.request({ path: path, method: 'GET' });
      // gapi.client.request returns a "response" not a fetch Response; need to read body
      var body = res.body;
      if (typeof body === 'undefined' && res.result) body = res.result;
      if (typeof body === 'string'){
        // Convert base64? gapi returns bytes string only for some endpoints.
        // Safer approach: fall back to fetch with OAuth header.
        throw new Error('gapi client returned string body; switching to fetch');
      }
      // If not usable, fall through to fetch
      throw new Error('Switch to fetch path');
    }catch(_ignored){
      // Fallback to window.fetch with OAuth header
      var token = null;
      try{
        var auth = this.gapi.client.getToken && this.gapi.client.getToken();
        token = auth && auth.access_token;
      }catch(_){}
      if (!this._fetch) throw new Error('fetch not available in this environment');
      var url = 'https://www.googleapis.com'+path;
      var r = await this._fetch(url, { headers: token ? { 'Authorization': 'Bearer '+token } : {} });
      if (!r.ok){
        var txt = await r.text().catch(function(){ return String(r.statusText||''); });
        throw new Error('GLB download failed: '+r.status+' '+txt+'\n\nIDが正しいか確認してください。共有URLのコピペ、または30文字以上の完全なFileIdを貼り付けてください。');
      }
      var blob = await r.blob();
      if (this._glbObjectURL) try{ URL.revokeObjectURL(this._glbObjectURL); }catch(_){}
      this._glbObjectURL = URL.createObjectURL(blob);
      this._lastAltMediaURL = url;
      this.dispatchEvent(new CustomEvent('glb:url', { detail: { fileId: fileId, objectUrl: this._glbObjectURL } }));
    }
  }

  /**
   * Helper to load GLB when input is a URL or id.
   * Emits the same events as loadGLBByFileId.
   * @param {string} input
   */
  async loadGLB(input){
    var id = this.extractDriveFileId(input);
    if (!id) throw new Error('Drive fileId もしくは共有URLを指定してください。');
    return this.loadGLBByFileId(id);
  }

  /** Core: Pin Spreadsheet resolve **/
  /**
   * Resolve spreadsheet id associated to the GLB file (same folder; appProperties.lociFor = fileId).
   * Returns {sheetId, name} or null. Emits 'sheet:resolved' on success.
   * @param {string} fileId (optional; defaults to the last GLB fileId)
   */
  async resolvePinSpreadsheet(fileId){
    var fid = fileId || this._glbFileId;
    if (!fid) return null;
    if (!this.gapi || !this.gapi.client || !this.gapi.client.drive) throw new Error('Drive API is not ready');

    // Get parent folder
    var meta = await this.gapi.client.drive.files.get({ fileId: fid, fields: 'parents' });
    var parents = (meta.result && meta.result.parents) || [];
    var parent = parents[0];
    if (!parent) return null;

    // Query candidate spreadsheet (with appProperties and fallback without it)
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

  /** Core: Pins **/
  /**
   * Load pins from spreadsheet (Sheets API first, fallback to Drive CSV export).
   * Emits 'pins:loaded' with array of pins.
   * @param {string} sheetId
   */
  async loadPins(sheetId){
    var sid = sheetId || this._sheetId;
    if (!sid) throw new Error('sheetId is required');
    var rows = null;

    // 1) Sheets API
    try{
      if (!this.gapi.client.sheets) await this.gapi.client.load('sheets', 'v4');
      var meta = await this.gapi.client.sheets.spreadsheets.get({ spreadsheetId: sid });
      var firstTitle = (meta.result && meta.result.sheets && meta.result.sheets[0] &&
                        meta.result.sheets[0].properties && meta.result.sheets[0].properties.title) || 'Sheet1';
      var vals = await this.gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: sid, range: firstTitle+'!A:Z' });
      rows = (vals.result && vals.result.values) || [];
    }catch(e){
      // 2) Drive CSV export fallback
      try{
        var res = await this.gapi.client.request({
          path: '/drive/v3/files/'+encodeURIComponent(sid)+'/export',
          method: 'GET',
          params: { mimeType: 'text/csv' }
        });
        var csv = (res.body || res.result || '')+'';
        rows = this._parseCSV(csv);
      }catch(e2){
        // both paths failed
        var msg = (e && e.result && e.result.error && e.result.error.message) ? e.result.error.message : (e && e.message ? e.message : String(e));
        var msg2 = (e2 && e2.result && e2.result.error && e2.result.error.message) ? e2.result.error.message : (e2 && e2.message ? e2.message : String(e2));
        var err = new Error('Pin sheet load failed.\nSheetsAPI: '+msg+'\nDriveCSV: '+msg2);
        this.dispatchEvent(new CustomEvent('error', { detail: err }));
        throw err;
      }
    }

    var pins = this._rowsToPins(rows);
    this.dispatchEvent(new CustomEvent('pins:loaded', { detail: { pins: pins, sheetId: sid } }));
    return pins;
  }

  /**
   * Minimal CSV parser for Drive export (handles quotes and CRLF).
   * @param {string} csv
   * @returns {string[][]}
   */
  _parseCSV(csv){
    var rows=[], row=[], cell='', q=false;
    for (var i=0;i<csv.length;i++){
      var ch = csv[i];
      if (q){
        if (ch === '"'){
          if (i+1<csv.length && csv[i+1] === '"'){ cell+='"'; i++; }
          else { q = false; }
        }else{
          cell += ch;
        }
      }else{
        if (ch === '"'){ q = true; }
        else if (ch === ','){ row.push(cell); cell=''; }
        else if (ch === '\n' || ch === '\r'){
          if (ch === '\r' && i+1<csv.length && csv[i+1] === '\n') i++;
          row.push(cell); rows.push(row); row=[]; cell='';
        }else{
          cell += ch;
        }
      }
    }
    if (cell.length>0 || row.length){ row.push(cell); rows.push(row); }
    return rows;
  }

  /**
   * Convert rows (A:Z) into pin objects with column name heuristics (JP/EN mixed).
   * @param {string[][]} rows
   * @returns {{id:any,title:string,body:string,img:string,_row:number}[]}
   */
  _rowsToPins(rows){
    if (!rows || !rows.length) return [];
    var header = rows[0].map(function(x){ return String(x||'').trim().toLowerCase(); });
    function H(names){
      for (var i=0;i<names.length;i++){
        var j = header.indexOf(names[i]);
        if (j >= 0) return j;
      }
      return -1;
    }
    var c_id    = H(['id','pinid','key','番号','no','ＩＤ']);
    var c_title = H(['title','name','captiontitle','タイトル','名称','題名','見出し']);
    var c_body  = H(['body','note','caption','description','本文','説明','メモ']);
    var c_img   = H(['img','image','photourl','thumbnail','画像','写真url','写真','サムネイル']);

    var out = [];
    for (var i=1;i<rows.length;i++){
      var r = rows[i] || [];
      var o = {_row: i+1};
      o.id    = (c_id>=0    ? r[c_id]    : '') || o._row;
      o.title = (c_title>=0 ? r[c_title] : '') || '';
      o.body  = (c_body>=0  ? r[c_body]  : '') || '';
      o.img   = (c_img>=0   ? r[c_img]   : '') || '';
      out.push(o);
    }
    return out;
  }

  /** Materials parsing (no three.js side-effects; UI decides how to apply) **/
  /**
   * Parse materials from rows (if present) to a pure JSON state map.
   * Expected headers example: material, color, opacity, metalness, roughness
   * @param {string[][]} rows
   * @returns {Record<string, any>}
   */
  rowsToMaterialState(rows){
    if (!rows || !rows.length) return {};
    var h = rows[0].map(function(x){ return String(x||'').trim().toLowerCase(); });
    function I(n){ var j = h.indexOf(n); return j>=0 ? j : -1; }
    var iName = I('material');
    if (iName<0) return {};
    var iColor = I('color'), iOpacity = I('opacity'), iMetal = I('metalness'), iRough = I('roughness');
    var state = {};
    for (var r=1;r<rows.length;r++){
      var row = rows[r] || [];
      var name = row[iName]; if (!name) continue;
      var obj = {};
      if (iColor>=0) obj.color = row[iColor];
      if (iOpacity>=0) obj.opacity = parseFloat(row[iOpacity]);
      if (iMetal>=0) obj.metalness = parseFloat(row[iMetal]);
      if (iRough>=0) obj.roughness = parseFloat(row[iRough]);
      state[name] = obj;
    }
    return state;
  }

  /** Cleanup **/
  revokeObjectURL(){
    if (this._glbObjectURL){ try{ URL.revokeObjectURL(this._glbObjectURL); }catch(_){ } this._glbObjectURL=null; }
  }
  get glbFileId(){ return this._glbFileId; }
  get sheetId(){ return this._sheetId; }
  get sheetTitle(){ return this._sheetTitle; }
}
