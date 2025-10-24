// data-layer.js
// Single place handling Drive (images) and Sheets (pins/materials).
// UI calls remain the same via compat-shim, but you can also call Data.* directly.

(function(){
  const enc = encodeURIComponent;

  const Data = {
    state: {
      glbId: null,
      parentId: null,
      spreadsheetId: null,
      sheetIdsByTitle: {}, // title -> sheetId
    },

    async init({ glbId } = {}) {
      this.state.glbId = glbId || Data._guessGLBId();
      if (!this.state.glbId) throw new Error('GLB id not found');
      this.state.parentId = await this._getParentFolderId(this.state.glbId);
      // resolve spreadsheet in parent or create one
      this.state.spreadsheetId = await this._resolveSpreadsheet(this.state.parentId);
      await this._ensureMaterialsHeader(this.state.spreadsheetId);
      await this._ensurePinsHeader(this.state.spreadsheetId);
      return this.state;
    },

    _guessGLBId() {
      try {
        const el = document.getElementById('glbUrl');
        const raw = (el?.value || location.search || '').trim();
        const m = raw.match(/[A-Za-z0-9_-]{25,}/);
        return m ? m[0] : null;
      } catch { return null; }
    },

    async _getParentFolderId(fileId) {
      const j = await window.Auth.fetchJSON(
        `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents&supportsAllDrives=true`
      );
      const p = j?.parents?.[0];
      if (!p) throw new Error('parent_not_found');
      return p;
    },

    async _resolveSpreadsheet(parentId) {
      // list spreadsheets in parent
      const q = enc(`'${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
      const list = await window.Auth.fetchJSON(
        `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=20&supportsAllDrives=true&includeItemsFromAllDrives=true`
      );
      const files = list.files || [];
      // If any has materials header, choose first. Otherwise pick the newest, or create.
      for (const f of files) {
        if (await this._hasMaterialsHeader(f.id)) return f.id;
      }
      if (files[0]?.id) return files[0].id;
      // create one
      const mk = await window.Auth.fetchJSON(`https://sheets.googleapis.com/v4/spreadsheets`, {
        method:'POST',
        body: JSON.stringify({ properties:{ title:`LociMyu_${new Date().toISOString().slice(0,19).replace(/[:T]/g,'-')}` } })
      });
      const ssid = mk.spreadsheetId;
      // move into parent
      const cur = await window.Auth.fetchJSON(
        `https://www.googleapis.com/drive/v3/files/${ssid}?fields=parents&supportsAllDrives=true`
      );
      const oldParents = (cur.parents||[]).join(',');
      await window.Auth.fetchJSON(
        `https://www.googleapis.com/drive/v3/files/${ssid}?addParents=${enc(parentId)}${oldParents?`&removeParents=${enc(oldParents)}`:''}&supportsAllDrives=true`,
        { method:'PATCH', body: JSON.stringify({}) }
      );
      return ssid;
    },

    async _hasMaterialsHeader(ssid) {
      try {
        const r = await window.Auth.fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}?includeGridData=true&ranges=${enc('materials!A1:K1')}&fields=sheets(properties(title),data(rowData(values(formattedValue))))`
        );
        const values = r?.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values || [];
        const row = values.map(v=>v.formattedValue||'').join(',').toLowerCase();
        return row.includes('id') && row.includes('name');
      } catch (e) {
        return false;
      }
    },

    async _ensureMaterialsHeader(ssid){
      // Create sheet if missing; set header
      const head = await window.Auth.fetchJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}`
      ).catch(()=>null);
      if (!head || !head.values) {
        // add sheet
        await window.Auth.fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`,
          { method:'POST', body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:'materials' } } }] }) }
        ).catch(()=>{});
        // header
        await window.Auth.fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'materials'!A1:K1")}?valueInputOption=RAW`,
          { method:'PUT', body: JSON.stringify({ values:[['id','name','mat','unlit','doubleSided','opacity','alphaTest','color','metal','rough','note']] }) }
        );
      }
    },

    async _ensurePinsHeader(ssid){
      const head = await window.Auth.fetchJSON(
        `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'pins'!A1:H1")}`
      ).catch(()=>null);
      if (!head || !head.values) {
        await window.Auth.fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}:batchUpdate`,
          { method:'POST', body: JSON.stringify({ requests:[{ addSheet:{ properties:{ title:'pins' } } }] }) }
        ).catch(()=>{});
        await window.Auth.fetchJSON(
          `https://sheets.googleapis.com/v4/spreadsheets/${ssid}/values/${enc("'pins'!A1:H1")}?valueInputOption=RAW`,
          { method:'PUT', body: JSON.stringify({ values:[['id','x','y','z','caption','imgId','imgName','note']] }) }
        );
      }
    },

    // -------- Drive (images) --------
    async listImages({ pageSize = 200 } = {}) {
      if (!this.state.parentId) throw new Error('not_initialized');
      const q = enc(`'${this.state.parentId}' in parents and mimeType contains 'image/' and trashed=false`);
      const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&orderBy=modifiedTime%20desc&pageSize=${pageSize}&supportsAllDrives=true&includeItemsFromAllDrives=true`;
      const r = await window.Auth.fetchJSON(url);
      return r.files || [];
    },

    // -------- Sheets (pins/materials) --------
    async appendPins(rows /* array of arrays */) {
      const ss = this.state.spreadsheetId;
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ss}/values/${enc("'pins'!A:Z")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      return await window.Auth.fetchJSON(url, { method:'POST', body: JSON.stringify({ values: rows }) });
    },

    async updateMaterialsRow(row /* array */) {
      const ss = this.state.spreadsheetId;
      // naive upsert: append; later can implement search+update if id matches
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${ss}/values/${enc("'materials'!A:Z")}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`;
      return await window.Auth.fetchJSON(url, { method:'POST', body: JSON.stringify({ values: [row] }) });
    },

    // -------- Helpers to be re-used by UI --------
    getSpreadsheetId() { return this.state.spreadsheetId; },
    getParentId() { return this.state.parentId; },
  };

  window.Data = Data;
})();