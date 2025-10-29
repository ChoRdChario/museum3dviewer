// material.ensure.hotfix.v6.js
// Non-invasive HOTFIX: force-create __LM_MATERIALS once sheet-context arrives.
// Safe for ES2018; no optional chaining/nullish coalescing.

(function(){
  var HOTFIX_TAG = 'V6_HOTFIX_AUTOCREATE_2025-10-30';
  console.log('[mat-hotfix] loaded', HOTFIX_TAG);

  function asPromise(x){
    try{
      if (x && typeof x.then === 'function') return x;
      return Promise.resolve(x);
    }catch(e){
      return Promise.resolve(null);
    }
  }

  async function getTok(){
    try{
      if (typeof getAccessToken === 'function'){
        var t = await asPromise(getAccessToken());
        if (t) return t;
      }
    }catch(e){ console.warn('[mat-hotfix] getAccessToken error', e); }
    try{
      if (typeof ensureToken === 'function'){
        var t2 = await asPromise(ensureToken({interactive:false}));
        if (t2) return t2;
      }
    }catch(e){ console.warn('[mat-hotfix] ensureToken error', e); }
    return null;
  }

  async function ensureSheetOnce(spreadsheetId){
    try{
      console.log('[mat-hotfix] ensure start', spreadsheetId);
      if (!spreadsheetId){ console.warn('[mat-hotfix] no spreadsheetId'); return false; }
      var tok = await getTok();
      if (!tok){ console.warn('[mat-hotfix] token missing'); return false; }
      var base = 'https://sheets.googleapis.com/v4/spreadsheets/' + encodeURIComponent(spreadsheetId);
      // existence
      var r = await fetch(base + '?fields=sheets.properties', { headers:{'Authorization':'Bearer '+tok} });
      console.log('[mat-hotfix] get status', r.status);
      if (!r.ok){
        if (r.status===401 || r.status===403){
          // hook first gesture to retry interactively
          var once = false;
          var handler = async function(){
            if (once) return;
            once = true;
            document.removeEventListener('pointerdown', handler, true);
            try{ await asPromise(ensureToken && ensureToken({interactive:true})); }catch(_){}
            await ensureSheetOnce(spreadsheetId);
          };
          document.addEventListener('pointerdown', handler, true);
        }
        return false;
      }
      var info = await r.json();
      var exists = false;
      if (info && info.sheets){
        for (var i=0;i<info.sheets.length;i++){
          var p = (info.sheets[i] && info.sheets[i].properties) || {};
          if (p.title === '__LM_MATERIALS'){ exists = true; break; }
        }
      }
      if (!exists){
        var body = { requests:[ { addSheet:{ properties:{ title:'__LM_MATERIALS', gridProperties:{ frozenRowCount:1 } } } } ] };
        var b = await fetch(base + ':batchUpdate', {
          method:'POST',
          headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
          body: JSON.stringify(body)
        });
        var bt = await b.text();
        console.log('[mat-hotfix] addSheet status', b.status, bt);
        if (!b.ok) return false;
      }
      var header = [["key","modelKey","materialKey","materialName","opacity","doubleSided","unlit","chromaEnabled","chromaColor","chromaTol","chromaFeather","updatedAt","updatedBy","sheetGid"]];
      var u = await fetch(base + '/values/' + encodeURIComponent('__LM_MATERIALS!A1:N1') + '?valueInputOption=RAW', {
        method:'PUT',
        headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
        body: JSON.stringify({ range:'__LM_MATERIALS!A1:N1', majorDimension:'ROWS', values: header })
      });
      var ut = await u.text();
      console.log('[mat-hotfix] header status', u.status, ut);
      return u.ok;
    }catch(err){
      console.warn('[mat-hotfix] ensure error', err);
      return false;
    }
  }

  // Run once when sheet-context arrives
  document.addEventListener('lm:sheet-context', function(e){
    try{
      var det = (e && e.detail) || {};
      console.log('[mat-hotfix] sheet-context', det);
      if (det && det.spreadsheetId){
        ensureSheetOnce(det.spreadsheetId);
      }
    }catch(err){
      console.warn('[mat-hotfix] handler error', err);
    }
  });
})();
