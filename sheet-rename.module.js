
/*! sheet-rename.module.js — robust token flow + minimal UI */
(function(){
  const DEBUG = /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a)=>{ if(DEBUG) console.log('[renameUI]', ...a); };

  function $(id){ return document.getElementById(id); }
  function findSheetSelect(){ return $('save-target-sheet') || $('sheet-select') || null; }
  function ensureWrapperForSelect(sel){
    let host = $('save-target-sheet-wrapper') || $('sheet-select-wrapper');
    if (host) return host;
    host = document.createElement('div');
    host.id = (sel.id==='save-target-sheet') ? 'save-target-sheet-wrapper' : 'sheet-select-wrapper';
    sel.parentNode.insertBefore(host, sel); host.appendChild(sel); return host;
  }

  function mount(){
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
      wire();
    }
    view('view'); syncFromSelect();
    log('UI mounted'); return true;
  }

  function syncFromSelect(){
    const sel = findSheetSelect(); if(!sel) return;
    const opt = sel.selectedOptions && sel.selectedOptions[0];
    window.currentSheetId = opt ? Number(opt.value) : null;
    window.currentSheetTitle = opt ? (opt.textContent||'').trim() : '';
    const label = $('sheet-rename-label'); const edit = $('sheet-rename-edit');
    if (label) label.textContent = window.currentSheetTitle || '(no sheet)';
    if (edit)  edit.disabled = !(window.currentSheetId!=null);
    sel.title = window.currentSheetTitle;
  }

  function view(mode){
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

  function wire(){
    $('sheet-rename-edit').onclick = ()=> view('edit');
    $('sheet-rename-label').onclick = ()=> view('edit');
    $('sheet-rename-label').ondblclick = ()=> view('edit');
    $('sheet-rename-cancel').onclick = ()=> view('view');
    $('sheet-rename-ok').onclick = onApply;
    $('sheet-rename-input').onkeydown = (e)=>{ if(e.key==='Enter') onApply(); else if(e.key==='Escape') view('view'); };

    const sel = findSheetSelect();
    if (sel){
      sel.addEventListener('change', syncFromSelect, { passive:true });
      new MutationObserver(syncFromSelect).observe(sel, { childList:true, subtree:true });
    }
  }

  async function onApply(){
    const input=$('sheet-rename-input'), spin=$('sheet-rename-spin'), ok=$('sheet-rename-ok'), cancel=$('sheet-rename-cancel'), label=$('sheet-rename-label');
    const sel = findSheetSelect();
    if (window.currentSheetId==null){ syncFromSelect(); if(window.currentSheetId==null) return; }

    const before = window.currentSheetTitle||'';
    const newTitle = (input.value||'').trim();
    const opt = sel && sel.querySelector(`option[value="${window.currentSheetId}"]`);
    if(!newTitle || newTitle===before || newTitle.length>100) { view('view'); return; }
    for (const o of Array.from(sel.options||[])){ if ((o.textContent||'').trim()===newTitle){ view('view'); return; } }

    // optimistic
    label.textContent = newTitle; if(opt) opt.textContent = newTitle; view('view');

    // token: silent -> interactive(一度だけ)
    let token = null, triedInteractive=false;
    for (let i=0;i<2 && !token;i++){
      try{
        if (typeof window.ensureToken==='function') await window.ensureToken({interactive: triedInteractive});
        if (typeof window.getAccessToken==='function') token = await window.getAccessToken();
      }catch(_){}
      if (!token) triedInteractive = true;
    }
    if (!token){ log('rename failed','no token'); label.textContent=before; if(opt) opt.textContent=before; return; }

    // call API
    try{
      input.disabled=ok.disabled=cancel.disabled=true; spin.style.display='inline-block';
      const spreadsheetId = window.currentSpreadsheetId;
      if(!spreadsheetId) throw new Error('spreadsheetId missing');
      await updateTitle(spreadsheetId, window.currentSheetId, newTitle, token);
      window.currentSheetTitle = newTitle;
      log('rename success', newTitle);
    }catch(e){
      label.textContent=before; if(opt) opt.textContent=before; window.currentSheetTitle=before; log('rename failed',e);
    }finally{
      input.disabled=ok.disabled=cancel.disabled=false; spin.style.display='none';
    }
  }

  async function updateTitle(spreadsheetId, sheetId, newTitle, token){
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = { requests: [ { updateSheetProperties: { properties: { sheetId: Number(sheetId), title: newTitle }, fields: 'title' } } ] };
    const res = await fetch(url, { method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!res.ok){ throw new Error('Sheets API '+res.status); }
  }

  (function auto(){ if (mount()) return; const mo=new MutationObserver(()=>{ if(mount()) mo.disconnect(); }); mo.observe(document.documentElement||document.body,{childList:true,subtree:true}); })();
  window.mountSheetRenameUI = mount;
})();
