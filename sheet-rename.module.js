
/*! sheet-rename.module.js — stable build (includes: findSheetSelect, dataset.title sync, spreadsheetId sniffer) */
(function(){
  const DEBUG = /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a)=>{ if(DEBUG) console.log('[renameUI]', ...a); };

  // --- spreadsheetId sniffer (reads ID from any Sheets API call) ---
  (function installSpreadsheetIdSniffer(){
    if (window.__LM_FETCH_SNIFFER_INSTALLED__) return;
    const orig = window.fetch;
    if (typeof orig !== 'function') return;
    window.fetch = function(input, init){
      try{
        let url = null;
        if (typeof input === 'string') url = input;
        else if (input && typeof input.url === 'string') url = input.url;
        if (url && url.indexOf('https://sheets.googleapis.com/v4/spreadsheets/') === 0){
          const m = url.match(/spreadsheets\/([^:\/?]+)/);
          if (m && m[1]){
            const sid = decodeURIComponent(m[1]);
            if (sid) { window.currentSpreadsheetId = sid; if (DEBUG) console.log('[renameUI] sniffed spreadsheetId', sid); }
          }
        }
      }catch(_){}
      return orig.apply(this, arguments);
    };
    window.__LM_FETCH_SNIFFER_INSTALLED__ = true;
  })();

  // --- small helpers ---
  function $(id){ return document.getElementById(id); }
  function findSheetSelect(){
    return $('save-target-sheet') || $('sheet-select') || document.querySelector('#tab-captions select, #captions select, .right-panel select') || null;
  }
  function ensureWrapperForSelect(sel){
    let host = $('save-target-sheet-wrapper') || $('sheet-select-wrapper');
    if (host) return host;
    host = document.createElement('div');
    host.id = (sel.id==='save-target-sheet') ? 'save-target-sheet-wrapper' : 'sheet-select-wrapper';
    sel.parentNode.insertBefore(host, sel); host.appendChild(sel); return host;
  }
  function listSheetsFromDOM(sel){
    const out = [];
    if (!sel) return out;
    for (const opt of Array.from(sel.options||[])){
      const id = opt.value ? Number(opt.value) : null;
      out.push({ sheetId:id, title:(opt.textContent||'').trim() });
    }
    return out;
  }
  function updateOptionDatasetTitle(opt, title){
    try{ if(opt){ if(!opt.dataset) opt.dataset = {}; opt.dataset.title = title; } }catch(_){}
  }

  // --- mount / UI ---
  function mountSheetRenameUI(){
    const sel = findSheetSelect(); if(!sel) return false;
    const anchor = ensureWrapperForSelect(sel); if(!anchor) return false;

    let root = $('sheet-rename');
    if (!root){
      root = document.createElement('div'); root.id = 'sheet-rename';
      root.innerHTML = [
        '<div class="sheet-rename-row">',
        '  <button id="sheet-rename-edit" class="sr-btn sr-edit" type="button" title="Rename">✎</button>',
        '  <span id="sheet-rename-label" class="sr-label"></span>',
        '  <input id="sheet-rename-input" class="sr-input" type="text" maxlength="100" />',
        '  <button id="sheet-rename-ok" class="sr-btn sr-ok" type="button" title="Apply">✓</button>',
        '  <button id="sheet-rename-cancel" class="sr-btn sr-cancel" type="button" title="Cancel">×</button>',
        '  <span id="sheet-rename-spin" class="sr-spin" aria-hidden="true"></span>',
        '</div>'
      ].join('');
      anchor.insertAdjacentElement('afterend', root);
      wireSheetRenameEvents();
    }
    updateSheetRenameView('view'); wireSelectChange();
    log('UI mounted'); return true;
  }

  function wireSelectChange(){
    const sel = findSheetSelect(); if (!sel) return;
    const syncFromSelect = ()=>{
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      const title = (opt && opt.textContent) ? opt.textContent.trim() : '';
      const id = (opt && opt.value) ? Number(opt.value) : null;
      if (id != null) window.currentSheetId = id;
      if (title) window.currentSheetTitle = title;
      sel.title = title;
      const label = $('sheet-rename-label');
      const edit  = $('sheet-rename-edit');
      if (label) label.textContent = title || '(no sheet)';
      if (edit)  edit.disabled = !(window.currentSheetId!=null);
    };
    syncFromSelect();
    sel.addEventListener('change', syncFromSelect, { passive:true });
    new MutationObserver(syncFromSelect).observe(sel, { childList:true, subtree:true });
  }

  function updateSheetRenameView(mode){
    const label=$('sheet-rename-label'), input=$('sheet-rename-input');
    const ok=$('sheet-rename-ok'), cancel=$('sheet-rename-cancel'), edit=$('sheet-rename-edit'), spin=$('sheet-rename-spin');
    if(!label||!input||!ok||!cancel||!edit||!spin) return;
    const title=(window.currentSheetTitle||'').trim();
    if(mode==='edit'){
      label.style.display='none'; input.style.display='inline-block';
      ok.style.display=cancel.style.display='inline-block'; edit.style.display='none'; spin.style.display='none';
      input.value=title; setTimeout(()=>{ input.focus(); input.select(); },0);
    }else{
      label.textContent=title||'(no sheet)';
      label.style.display='inline'; input.style.display='none';
      ok.style.display=cancel.style.display='none'; edit.style.display='inline-block'; spin.style.display='none';
      edit.disabled = !(window.currentSheetId!=null);
    }
  }

  function wireSheetRenameEvents(){
    const edit=$('sheet-rename-edit'), cancel=$('sheet-rename-cancel'), ok=$('sheet-rename-ok'), input=$('sheet-rename-input'), label=$('sheet-rename-label');
    if(!edit||!cancel||!ok||!input||!label) return;
    edit.onclick = ()=> updateSheetRenameView('edit');
    label.onclick = ()=> updateSheetRenameView('edit');
    label.ondblclick = ()=> updateSheetRenameView('edit');
    cancel.onclick = ()=> updateSheetRenameView('view');
    ok.onclick = applySheetRename;
    input.onkeydown = (e)=>{ if(e.key==='Enter') applySheetRename(); else if(e.key==='Escape') updateSheetRenameView('view'); };
  }

  async function applySheetRename(){
    const input=$('sheet-rename-input'), spin=$('sheet-rename-spin'), ok=$('sheet-rename-ok'), cancel=$('sheet-rename-cancel'), label=$('sheet-rename-label');
    const sel = findSheetSelect();
    if (window.currentSheetId==null){ wireSelectChange(); if(window.currentSheetId==null) return; }

    const before = window.currentSheetTitle||'';
    const newTitle = (input.value||'').trim();
    const opt = sel && sel.querySelector(`option[value="${window.currentSheetId}"]`);
    if(!newTitle || newTitle===before || newTitle.length>100){ updateSheetRenameView('view'); return; }
    for (const o of Array.from(sel.options||[])){ if ((o.textContent||'').trim()===newTitle){ updateSheetRenameView('view'); return; } }

    // optimistic
    label.textContent = newTitle; if(opt) opt.textContent = newTitle; updateSheetRenameView('view');

    // token: silent then interactive
    let token = null, triedInteractive=false;
    for (let i=0;i<2 && !token;i++){
      try{
        if (typeof window.ensureToken==='function') await window.ensureToken({interactive: triedInteractive});
        if (typeof window.getAccessToken==='function') token = await window.getAccessToken();
      }catch(_){}
      if (!token) triedInteractive = true;
    }
    if (!token){ log('rename failed', new Error('no token')); label.textContent=before; if(opt) opt.textContent=before; return; }

    // spreadsheet id may be sniffed late; short wait if missing
    if (!window.currentSpreadsheetId){
      for (let t=0;t<5 && !window.currentSpreadsheetId;t++){ await new Promise(r=>setTimeout(r,60)); }
    }
    if (!window.currentSpreadsheetId){
      log('rename failed', new Error('spreadsheetId missing')); label.textContent=before; if(opt) opt.textContent=before; return;
    }

    // call API
    try{
      input.disabled=ok.disabled=cancel.disabled=true; spin.style.display='inline-block';
      const spreadsheetId = window.currentSpreadsheetId;
      await sheetsUpdateTitle(spreadsheetId, window.currentSheetId, newTitle, token);
      window.currentSheetTitle = newTitle;
      updateOptionDatasetTitle(opt, newTitle);
      try{ if (typeof ensureIndex==='function') ensureIndex(); }catch(_){}
      log('rename success', newTitle);
    }catch(e){
      label.textContent=before; if(opt) opt.textContent=before; window.currentSheetTitle=before; updateOptionDatasetTitle(opt, before);
      log('rename failed', e);
    }finally{
      input.disabled=ok.disabled=cancel.disabled=false; spin.style.display='none';
    }
  }

  async function sheetsUpdateTitle(spreadsheetId, sheetId, newTitle, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = { requests: [ { updateSheetProperties: { properties: { sheetId: Number(sheetId), title: newTitle }, fields: 'title' } } ] };
    const res = await fetch(url, { method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!res.ok){
      let t=''; try{ t=await res.text(); }catch(_){}
      throw new Error(`Sheets API ${res.status}: ${t||''}`);
    }
  }

  // auto-mount
  (function autoMount(){
    if (mountSheetRenameUI()) return;
    const mo=new MutationObserver(()=>{ if(mountSheetRenameUI()) mo.disconnect(); });
    mo.observe(document.documentElement||document.body,{childList:true,subtree:true});
    let tries=30; const tm=setInterval(()=>{ if(mountSheetRenameUI()||--tries<=0) clearInterval(tm); },200);
  })();

  // expose (optional)
  window.mountSheetRenameUI = mountSheetRenameUI;
})();
