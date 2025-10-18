
/*! sheet-rename.module.js - robust inline rename UI for Google Sheets tab (A-plan, auto-detect) */
(function(){
  const DEBUG = /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a)=>{ if(DEBUG) console.log('[renameUI]', ...a); };

  
  function __sr_updateOptionDatasetTitle(opt, title){
    try{ if(opt){ if(!opt.dataset) opt.dataset = {}; opt.dataset.title = title; } }catch(_){}
  }
function findSheetSelect(){
    let sel = document.getElementById('sheet-select') || document.getElementById('save-target-sheet');
    if (sel) return sel;
    sel = document.querySelector('#tab-captions select, #captions select, .right-panel select');
    if (sel) return sel;
    sel = Array.from(document.querySelectorAll('select')).find(s=>!s.multiple && s.options);
    return sel || null;
  }

  function ensureWrapperForSelect(sel){
    let host = document.getElementById('sheet-select-wrapper') || document.getElementById('save-target-sheet-wrapper');
    if (host) return host;
    host = document.createElement('div');
    host.id = (sel.id === 'save-target-sheet') ? 'save-target-sheet-wrapper' : 'sheet-select-wrapper';
    sel.parentNode.insertBefore(host, sel);
    host.appendChild(sel);
    return host;
  }

  function listSheetsFromDOM(sel){
    const out = [];
    if (!sel) return out;
    Array.from(sel.options || []).forEach(opt=>{
      const id = opt.value ? Number(opt.value) : null;
      out.push({ sheetId: id, title: (opt.textContent||'').trim() });
    });
    return out;
  }

  function mountSheetRenameUI(){
    const sel = findSheetSelect();
    if(!sel){ log('no select found yet'); return false; }
    const anchor = ensureWrapperForSelect(sel);
    if(!anchor){ log('no anchor'); return false; }

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
      wireSheetRenameEvents();
    }
    updateSheetRenameView('view');
    wireSelectChange();
    log('mounted UI');
    return true;
  }

  function currentSheets(){
    const sel = findSheetSelect();
    const dom = listSheetsFromDOM(sel);
    if (dom.length) return dom;
    if (Array.isArray(window.allSheets) && window.allSheets.length) return window.allSheets;
    return [];
  }

  function updateSheetRenameView(mode){
    const label = document.getElementById('sheet-rename-label');
    const input = document.getElementById('sheet-rename-input');
    const ok = document.getElementById('sheet-rename-ok'), cancel = document.getElementById('sheet-rename-cancel');
    const edit = document.getElementById('sheet-rename-edit');
    const spin = document.getElementById('sheet-rename-spin'); const hint = document.getElementById('sheet-rename-hint');
    if(!label||!input||!ok||!cancel||!edit||!spin||!hint) return;
    const title = (window.currentSheetTitle||'').trim();
    if(mode==='edit'){
      label.style.display='none';
      input.style.display='inline-block';
      ok.style.display=cancel.style.display='inline-block';
      edit.style.display='none'; spin.style.display='none';
      hint.textContent='';
      input.value = title;
      setTimeout(()=>{ input.focus(); input.select(); }, 0);
    }else{
      label.textContent = title || '(no sheet)';
      label.style.display='inline';
      input.style.display='none';
      ok.style.display=cancel.style.display='none';
      edit.style.display='inline-block'; spin.style.display='none';
      const ready = !!(window.currentSpreadsheetId && window.currentSheetId!=null);
      edit.disabled = !ready;
      if(!ready) hint.textContent='シートを選択すると名前を変更できます';
    }
  }

  function wireSheetRenameEvents(){
    const edit=document.getElementById('sheet-rename-edit'), cancel=document.getElementById('sheet-rename-cancel'), ok=document.getElementById('sheet-rename-ok'), input=document.getElementById('sheet-rename-input');
    if(!edit||!cancel||!ok||!input) return;
    edit.onclick = ()=>updateSheetRenameView('edit');
    const labelEl = document.getElementById('sheet-rename-label');
    if(labelEl){ labelEl.onclick = ()=>updateSheetRenameView('edit'); labelEl.ondblclick = ()=>updateSheetRenameView('edit'); }

    cancel.onclick = ()=>updateSheetRenameView('view');
    wireSelectChange();
    ok.onclick = applySheetRename;
    input.onkeydown = (e)=>{
      if(e.key==='Enter'){ applySheetRename(); }
      else if(e.key==='Escape'){ updateSheetRenameView('view');
    wireSelectChange(); }
    };
  }

  async function applySheetRename(){
    const input = document.getElementById('sheet-rename-input'); const hint=document.getElementById('sheet-rename-hint');
    const spin = document.getElementById('sheet-rename-spin'); const ok=document.getElementById('sheet-rename-ok'); const cancel=document.getElementById('sheet-rename-cancel');
    const label = document.getElementById('sheet-rename-label');
    const sel = findSheetSelect();

    if(!window.currentSpreadsheetId || window.currentSheetId==null){
      hint.textContent = '先にシートを選択してください';
      return;
    }

    let newTitle = (input.value||'').trim();
    const sheets = currentSheets();
    const currentId = window.currentSheetId;
    const before = window.currentSheetTitle||'';

    if(!newTitle){ hint.textContent='空の名前は使えません'; return; }
    if(newTitle===before){ updateSheetRenameView('view');
    wireSelectChange(); return; }
    if(newTitle.length>100){ hint.textContent='100文字以内で指定してください'; return; }
    if(sheets.some(s => (s.title||'') === newTitle)){ hint.textContent='同名のシートが既にあります'; return; }

    if(label) label.textContent = newTitle;
    updateSheetRenameView('view');
    wireSelectChange();
    try{
      const opt = sel && sel.querySelector(`option[value="${currentId}"]`);
      if(opt) opt.textContent = newTitle;
    }catch(_){}

    try{
      input.disabled=true; ok.disabled=cancel.disabled=true; spin.style.display='inline-block';
      const token = (typeof ensureToken==='function') ? ensureToken() : (typeof getAccessToken==='function' ? getAccessToken() : null);
      if(!token) throw new Error('auth token not available');
      await sheetsUpdateTitle(window.currentSpreadsheetId, currentId, newTitle, token);
      window.currentSheetTitle = newTitle;
      __sr_updateOptionDatasetTitle(opt, newTitle);
      try{ if(typeof ensureIndex==='function') ensureIndex(); }catch(_){}
      if (Array.isArray(window.allSheets)){
        window.allSheets = window.allSheets.map(s => (s.sheetId===currentId ? Object.assign({}, s, {title:newTitle}) : s));
      }
      log('rename success', newTitle);
    }catch(e){
      if(label) label.textContent = before;
      try{
        const opt = sel && sel.querySelector(`option[value="${currentId}"]`);
        if(opt) opt.textContent = before;
      }catch(_){}
      window.currentSheetTitle = before;
      hint.textContent = (e && e.message) ? String(e.message) : 'シート名の変更に失敗しました';
      log('rename failed', e);
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

  function autoMount(){
    let mounted = mountSheetRenameUI();
    wireSelectChange();
    if (mounted) return;
    const obs = new MutationObserver(()=>{
      const ok = mountSheetRenameUI();
      if (ok) { obs.disconnect(); }
    });
    obs.observe(document.documentElement || document.body, { childList:true, subtree:true });
    let tries = 30;
    const timer = setInterval(()=>{
      if (mountSheetRenameUI()) { clearInterval(timer); }
      if (--tries<=0) clearInterval(timer);
    }, 200);
  }

  autoMount();
  window.mountSheetRenameUI = mountSheetRenameUI;
})();

  function wireSelectChange(){
    const sel = findSheetSelect && findSheetSelect();
    if(!sel) return;
    // Set initial tooltip and sync globals if available
    try {
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      if (opt) {
        sel.title = (opt.textContent||'').trim();
        if (window.currentSheetId == null) window.currentSheetId = Number(opt.value);
        if (!window.currentSheetTitle) window.currentSheetTitle = sel.title;
      }
    }catch(_){}
    sel.addEventListener('change', ()=>{
      const opt = sel.selectedOptions && sel.selectedOptions[0];
      const title = (opt && opt.textContent) ? opt.textContent.trim() : '';
      const id = (opt && opt.value) ? Number(opt.value) : null;
      window.currentSheetId = id;
      window.currentSheetTitle = title;
      sel.title = title;
      // Reflect to inline label if exists
      try{
        const label = document.getElementById('sheet-rename-label');
        if(label) label.textContent = title || '(no sheet)';
        const edit = document.getElementById('sheet-rename-edit');
        if (edit) edit.disabled = !(window.currentSpreadsheetId && window.currentSheetId!=null);
      }catch(_){}
    }, { passive:true });
  }
