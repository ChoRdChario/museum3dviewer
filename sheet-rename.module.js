
/*! sheet-rename.module.js - inline rename UI for Google Sheets tab (A-plan) */
(function(){
  const $ = (id) => document.getElementById(id);

  function findSheetSelectWrapper(){
    // Try known wrapper ids
    let host = $('sheet-select-wrapper') || $('save-target-sheet-wrapper');
    if (host) return host;
    // Find select element (support both ids)
    const sel = document.getElementById('sheet-select') || document.getElementById('save-target-sheet');
    if (!sel) return null;
    // Create wrapper next to the select we found
    host = document.createElement('div');
    host.id = (sel.id === 'save-target-sheet') ? 'save-target-sheet-wrapper' : 'sheet-select-wrapper';
    sel.parentNode.insertBefore(host, sel);
    host.appendChild(sel);
    return host;
  }

  function listSheetsFromDOM(){
    const sel = document.getElementById('sheet-select') || document.getElementById('save-target-sheet');
    const out = [];
    if (sel) {
      Array.from(sel.options).forEach(opt=>{
        out.push({ sheetId: opt.value? Number(opt.value) : null, title: opt.textContent.trim() });
      });
    }
    return out;
  }

  function mountSheetRenameUI(){
    const anchor = findSheetSelectWrapper();
    if(!anchor) return;

    let host = document.getElementById('sheet-rename');
    if (!host){
      host = document.createElement('div');
      host.id = 'sheet-rename';
      host.innerHTML = [
        '<div class="sheet-rename-row">',
        '  <button id="sheet-rename-edit" aria-label="Rename sheet" title="Rename" class="sr-btn sr-edit" type="button">✎</button>',
        '  <span id="sheet-rename-label" class="sr-label"></span>',
        '  <input id="sheet-rename-input" class="sr-input" type="text" maxlength="100" />',
        '  <button id="sheet-rename-ok" class="sr-btn sr-ok" title="Apply" type="button">✓</button>',
        '  <button id="sheet-rename-cancel" class="sr-btn sr-cancel" title="Cancel" type="button">×</button>',
        '  <span id="sheet-rename-spin" class="sr-spin" aria-hidden="true"></span>',
        '  <div id="sheet-rename-hint" class="sr-hint" aria-live="polite"></div>',
        '</div>'
      ].join('');
      anchor.insertAdjacentElement('afterend', host);
    }
    updateSheetRenameView('view');
    wireSheetRenameEvents();
  }

  function currentSheets(){
    if (Array.isArray(window.allSheets) && window.allSheets.length) return window.allSheets;
    const dom = listSheetsFromDOM();
    if (dom.length) return dom;
    return [];
  }

  function updateSheetRenameView(mode){
    const label = $('sheet-rename-label');
    const input = $('sheet-rename-input');
    const ok = $('sheet-rename-ok'), cancel = $('sheet-rename-cancel');
    const edit = $('sheet-rename-edit');
    const spin = $('sheet-rename-spin'); const hint = $('sheet-rename-hint');
    if(!label||!input||!ok||!cancel||!edit||!spin||!hint) return;
    if(mode==='edit'){
      label.style.display='none';
      input.style.display='inline-block';
      ok.style.display=cancel.style.display='inline-block';
      edit.style.display='none'; spin.style.display='none';
      hint.textContent='';
      input.value = (window.currentSheetTitle||'').trim();
      setTimeout(()=>{ input.focus(); input.select(); }, 0);
    }else{
      label.textContent = window.currentSheetTitle || '(no sheet)';
      label.style.display='inline';
      input.style.display='none';
      ok.style.display=cancel.style.display='none';
      edit.style.display='inline-block'; spin.style.display='none';
    }
  }

  function wireSheetRenameEvents(){
    const edit=$('sheet-rename-edit'), cancel=$('sheet-rename-cancel'), ok=$('sheet-rename-ok'), input=$('sheet-rename-input');
    if(!edit||!cancel||!ok||!input) return;
    edit.onclick = ()=>updateSheetRenameView('edit');
    cancel.onclick = ()=>updateSheetRenameView('view');
    ok.onclick = applySheetRename;
    input.onkeydown = (e)=>{
      if(e.key==='Enter'){ applySheetRename(); }
      else if(e.key==='Escape'){ updateSheetRenameView('view'); }
    };
  }

  async function applySheetRename(){
    const input = $('sheet-rename-input'); const hint=$('sheet-rename-hint');
    const spin = $('sheet-rename-spin'); const ok=$('sheet-rename-ok'); const cancel=$('sheet-rename-cancel');
    const label = $('sheet-rename-label');

    let newTitle = (input.value||'').trim();
    const sheets = currentSheets();
    const currentId = window.currentSheetId;
    const before = window.currentSheetTitle||'';

    if(!newTitle){ hint.textContent='空の名前は使えません'; return; }
    if(newTitle===before){ updateSheetRenameView('view'); return; }
    if(newTitle.length>100){ hint.textContent='100文字以内で指定してください'; return; }
    if(sheets.some(s => (s.title||'') === newTitle)){ hint.textContent='同名のシートが既にあります'; return; }

    if(label) label.textContent = newTitle;
    updateSheetRenameView('view');
    try{
      const opt = (document.querySelector(`#sheet-select option[value="${currentId}"]`) || document.querySelector(`#save-target-sheet option[value="${currentId}"]`));
      if(opt) opt.textContent = newTitle;
    }catch(_){}

    try{
      input.disabled=true; ok.disabled=cancel.disabled=true; spin.style.display='inline-block';
      const token = (typeof ensureToken==='function') ? ensureToken() : (typeof getAccessToken==='function' ? getAccessToken() : null);
      if(!token) throw new Error('auth token not available');
      await sheetsUpdateTitle(window.currentSpreadsheetId, currentId, newTitle, token);
      window.currentSheetTitle = newTitle;
      if (Array.isArray(window.allSheets)){
        window.allSheets = window.allSheets.map(s => (s.sheetId===currentId ? Object.assign({}, s, {title:newTitle}) : s));
      }
    }catch(e){
      if(label) label.textContent = before;
      try{
        const opt = (document.querySelector(`#sheet-select option[value="${currentId}"]`) || document.querySelector(`#save-target-sheet option[value="${currentId}"]`));
        if(opt) opt.textContent = before;
      }catch(_){}
      window.currentSheetTitle = before;
      $('sheet-rename-hint').textContent = (e && e.message) ? String(e.message) : 'シート名の変更に失敗しました';
    }finally{
      input.disabled=false; ok.disabled=cancel.disabled=false; spin.style.display='none';
    }
  }

  async function sheetsUpdateTitle(spreadsheetId, sheetId, newTitle, token){
    if(!spreadsheetId || !sheetId) throw new Error('missing spreadsheetId/sheetId');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
    const body = { requests: [ { updateSheetProperties: { properties: { sheetId: sheetId, title: newTitle }, fields: 'title' } } ] };
    const res = await fetch(url, { method:'POST', headers:{ 'Authorization':'Bearer '+token, 'Content-Type':'application/json' }, body: JSON.stringify(body) });
    if(!res.ok){
      let t=''; try{ t=await res.text(); }catch(_){}
      throw new Error(`API ${res.status}: ${t||'updateSheetProperties failed'}`);
    }
  }

  function tryMount(times=20){
    if (document.readyState === 'complete' || document.readyState === 'interactive'){
      const sel = document.getElementById('sheet-select') || document.getElementById('save-target-sheet');
      if(sel && (window.currentSheetId!=null)){
        mountSheetRenameUI(); return;
      }
    }
    if(times>0) setTimeout(()=>tryMount(times-1), 100);
  }
  tryMount();

  window.mountSheetRenameUI = mountSheetRenameUI;
})();
