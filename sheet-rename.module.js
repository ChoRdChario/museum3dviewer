
/*! sheet-rename.module.js — rename UI using robust auth (await ensureToken) */
(function(){
  const DEBUG = /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a)=>{ if(DEBUG) console.log('[renameUI]', ...a); };

  function findSheetSelect(){
    let sel = document.getElementById('save-target-sheet') || document.getElementById('sheet-select');
    return sel || null;
  }
  function ensureWrapperForSelect(sel){
    let host = document.getElementById('save-target-sheet-wrapper') || document.getElementById('sheet-select-wrapper');
    if (host) return host;
    host = document.createElement('div');
    host.id = (sel.id==='save-target-sheet') ? 'save-target-sheet-wrapper' : 'sheet-select-wrapper';
    sel.parentNode.insertBefore(host, sel);
    host.appendChild(sel);
    return host;
  }
  function listSheetsFromDOM(sel){
    const out = [];
    if (!sel) return out;
    Array.from(sel.options||[]).forEach(opt=> out.push({ sheetId: Number(opt.value), title: (opt.textContent||'').trim() }));
    return out;
  }

  function mountSheetRenameUI(){
    const sel = findSheetSelect(); if(!sel) return false;
    const anchor = ensureWrapperForSelect(sel); if(!anchor) return false;
    let root = document.getElementById('sheet-rename');
    if (!root){
      root = document.createElement('div');
      root.id = 'sheet-rename';
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
    const sel = findSheetSelect(); if(!sel) return;
    const sync = ()=>{
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      window.currentSheetId = opt ? Number(opt.value) : null;
      window.currentSheetTitle = opt ? (opt.textContent||'').trim() : '';
      const label = document.getElementById('sheet-rename-label');
      const edit  = document.getElementById('sheet-rename-edit');
      if (label) label.textContent = window.currentSheetTitle || '(no sheet)';
      if (edit)  edit.disabled = !(window.currentSheetId!=null);
      sel.title = window.currentSheetTitle;
    };
    sync();
    sel.addEventListener('change', sync, { passive:true });
    new MutationObserver(sync).observe(sel, { childList:true, subtree:true });
  }

  function updateSheetRenameView(mode){
    const label = document.getElementById('sheet-rename-label');
    const input = document.getElementById('sheet-rename-input');
    const ok = document.getElementById('sheet-rename-ok');
    const cancel = document.getElementById('sheet-rename-cancel');
    const edit = document.getElementById('sheet-rename-edit');
    const spin = document.getElementById('sheet-rename-spin');
    if(!label||!input||!ok||!cancel||!edit||!spin) return;
    const title = (window.currentSheetTitle||'').trim();
    if (mode==='edit'){
      label.style.display='none'; input.style.display='inline-block';
      ok.style.display=cancel.style.display='inline-block'; edit.style.display='none'; spin.style.display='none';
      input.value = title; setTimeout(()=>{input.focus(); input.select();},0);
    }else{
      label.textContent = title || '(no sheet)'; label.style.display='inline';
      input.style.display='none'; ok.style.display=cancel.style.display='none';
      edit.style.display='inline-block'; spin.style.display='none';
      edit.disabled = !(window.currentSheetId!=null);
    }
  }

  function wireSheetRenameEvents(){
    const edit=document.getElementById('sheet-rename-edit');
    const cancel=document.getElementById('sheet-rename-cancel');
    const ok=document.getElementById('sheet-rename-ok');
    const input=document.getElementById('sheet-rename-input');
    const label=document.getElementById('sheet-rename-label');
    if(!edit||!cancel||!ok||!input||!label) return;
    edit.onclick = ()=> updateSheetRenameView('edit');
    label.onclick = ()=> updateSheetRenameView('edit');
    label.ondblclick = ()=> updateSheetRenameView('edit');
    cancel.onclick = ()=> updateSheetRenameView('view');
    ok.onclick = applySheetRename;
    input.onkeydown = (e)=>{ if(e.key==='Enter') applySheetRename(); else if(e.key==='Escape') updateSheetRenameView('view'); };
  }

  async function applySheetRename(){
    const input = document.getElementById('sheet-rename-input');
    const spin  = document.getElementById('sheet-rename-spin');
    const ok    = document.getElementById('sheet-rename-ok');
    const cancel= document.getElementById('sheet-rename-cancel');
    const label = document.getElementById('sheet-rename-label');
    const sel   = findSheetSelect();
    if (window.currentSheetId==null){ wireSelectChange(); if(window.currentSheetId==null) return; }

    const before = window.currentSheetTitle||'';
    const newTitle = (input.value||'').trim();
    const sheets = listSheetsFromDOM(sel);
    const currentId = window.currentSheetId;
    if(!newTitle || newTitle===before || newTitle.length>100 || sheets.some(s => (s.title||'')===newTitle)){ updateSheetRenameView('view'); return; }

    // optimistic
    label.textContent=newTitle;
    try{ const opt = sel && sel.querySelector(`option[value="${currentId}"]`); if(opt) opt.textContent = newTitle; }catch(_){}
    updateSheetRenameView('view');

    // ---- token handling (silent first) ----
    try{
      if (typeof window.ensureToken === 'function'){
        await window.ensureToken({interactive:false});
      }
    }catch(_){}
    let token = null;
    try{
      if (typeof window.getAccessToken === 'function'){
        token = await window.getAccessToken();
      }
    }catch(_){}
    if (!token){
      // last resort: interactive one-time prompt
      try{ if (typeof window.ensureToken==='function'){ await window.ensureToken({interactive:true}); token = await window.getAccessToken(); } }catch(_){}
    }
    if (!token){ log('rename failed','no token'); return; }

    // ---- call Sheets ----
    try{
      input.disabled=ok.disabled=cancel.disabled=true; spin.style.display='inline-block';
      const spreadsheetId = window.currentSpreadsheetId;
      if(!spreadsheetId){ log('rename failed','no spreadsheetId'); throw new Error('spreadsheetId missing'); }
      await sheetsUpdateTitle(spreadsheetId, currentId, newTitle, token);
      window.currentSheetTitle = newTitle;
      log('rename success', newTitle);
    }catch(e){
      // rollback
      label.textContent = before;
      try{ const opt = sel && sel.querySelector(`option[value="${currentId}"]`); if(opt) opt.textContent = before; }catch(_){}
      window.currentSheetTitle = before;
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
      throw new Error(`API ${res.status}: ${t||'updateSheetProperties failed'}`);
    }
  }

  // auto
  (function autoMount(){
    if (mountSheetRenameUI()) return;
    const mo=new MutationObserver(()=>{ if(mountSheetRenameUI()) mo.disconnect(); });
    mo.observe(document.documentElement||document.body,{childList:true,subtree:true});
    let tries=30; const tm=setInterval(()=>{ if(mountSheetRenameUI()||--tries<=0) clearInterval(tm); },200);
  })();
  window.mountSheetRenameUI = mountSheetRenameUI;
})();
