export function mountDiagnostics({ bus, store, viewer, listSiblingImages, findOrCreateSpreadsheetInSameFolder, getGlbId }){
  const side = document.getElementById('side');
  const wrap = document.createElement('div');
  wrap.id = 'diag';
  wrap.innerHTML = `
    <style>
      #diag { margin-top: 12px; padding-top: 12px; border-top: 1px solid #222; }
      #diag h4{ margin: 0 0 8px; font-size: 13px; }
      #diag .tests{ display: grid; gap: 6px; }
      #diag .t{ display:flex; align-items:center; justify-content:space-between; background:#131313; border:1px solid #252525; border-radius:8px; padding:8px; }
      #diag .t .name{ font-weight:600; font-size:12px; }
      #diag .t .res{ font-size:12px; }
      #diag .log{ font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; background:#0f0f0f; border:1px solid #222; border-radius:8px; padding:8px; max-height:140px; overflow:auto; display:none; }
      #diag .actions{ display:flex; gap:8px; margin-top:8px; }
      #diag button{ background:#1e1e1e; color:#fff; border:1px solid #333; border-radius:8px; padding:6px 10px; cursor:pointer; font-size:12px; }
      #diag .pill{ padding:2px 6px; border-radius:999px; border:1px solid #333; }
      #diag .pass{ color:#79ffa1; border-color:#214d30; background:#0f2216; }
      #diag .fail{ color:#ff7a7a; border-color:#4d2121; background:#221010; }
      #diag .warn{ color:#ffd27a; border-color:#4d3a21; background:#221a0f; }
    </style>
    <h4>Self Diagnostics</h4>
    <div class="tests">
      <div class="t" data-key="auth"><div class="name">Auth (OAuth token)</div><div class="res pill">pending</div></div>
      <div class="t" data-key="driveList"><div class="name">Drive: Sibling Images listing</div><div class="res pill">pending</div></div>
      <div class="t" data-key="heic"><div class="name">HEIC converter (heic2any load)</div><div class="res pill">pending</div></div>
      <div class="t" data-key="sheets"><div class="name">Sheets access (create/find spreadsheet)</div><div class="res pill">pending</div></div>
      <div class="t" data-key="viewer"><div class="name">Viewer status (model loaded)</div><div class="res pill">pending</div></div>
      <div class="t" data-key="pins"><div class="name">Pins bus wiring (add/select events)</div><div class="res pill">pending</div></div>
    </div>
    <div class="actions">
      <button id="btn-run-all">Run all</button>
      <button id="btn-show-log">Show log</button>
    </div>
    <div class="log" id="diag-log"></div>
  `;
  side.appendChild(wrap);
  const logEl = wrap.querySelector('#diag-log');
  const btnAll = wrap.querySelector('#btn-run-all');
  const btnLog = wrap.querySelector('#btn-show-log');

  const setRes = (key, status, msg='')=>{
    const el = wrap.querySelector(`.t[data-key="${key}"] .res`);
    if(!el) return;
    el.classList.remove('pass','fail','warn');
    if(status==='pass') el.classList.add('pass');
    if(status==='fail') el.classList.add('fail');
    if(status==='warn') el.classList.add('warn');
    el.textContent = status + (msg? `: ${msg}`:'');
    if(msg) { log(`[${key}] ${msg}`); }
  };
  const log = (m)=>{
    logEl.style.display='block';
    logEl.textContent += (m + '\n');
    logEl.scrollTop = logEl.scrollHeight;
  };

  async function testAuth(){
    try{
      const hasGapi = !!window.gapi?.client;
      const token = gapi?.client?.getToken?.();
      if(hasGapi && token?.access_token){ setRes('auth','pass','token present'); }
      else if(hasGapi){ setRes('auth','warn','gapi ready, token missing (Sign in required)'); }
      else { setRes('auth','fail','gapi.client not ready'); }
    }catch(e){ setRes('auth','fail', String(e)); }
  }

  async function testDriveList(){
    try{
      const glbId = (typeof getGlbId === 'function' && getGlbId()) || new URLSearchParams(location.search).get('id');
      if(!glbId){ setRes('driveList','warn','no ?id provided'); return; }
      if(!window.gapi?.client){ setRes('driveList','fail','gapi not ready'); return; }
      const list = await listSiblingImages(glbId);
      setRes('driveList','pass', `found ${list.length} images`);
      if(list.length===0) log('Place jpeg/png/webp/heic in the same Drive folder as the GLB.');
    }catch(e){ setRes('driveList','fail', String(e)); }
  }

  async function testHeic(){
    try{
      const mod = await import('../app/drive_images.js');
      await mod.ensureHeic2Any();
      if(window.heic2any){ setRes('heic','pass','heic2any loaded'); }
      else { setRes('heic','fail','heic2any not available'); }
    }catch(e){ setRes('heic','fail', String(e)); }
  }

  async function testSheets(){
    try{
      const glbId = (typeof getGlbId === 'function' && getGlbId()) || new URLSearchParams(location.search).get('id');
      if(!glbId){ setRes('sheets','warn','no ?id provided'); return; }
      if(!window.gapi?.client){ setRes('sheets','fail','gapi not ready'); return; }
      const ssId = await findOrCreateSpreadsheetInSameFolder(glbId);
      // read header row if exists
      try{
        const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId:ssId, range:'pins!A1:Z1' });
        const header = (res.result.values && res.result.values[0]) || [];
        setRes('sheets','pass', `sheet ok (${header.length || 0} cols)`);
      }catch(_){
        setRes('sheets','pass', 'sheet ok (no header yet)');
      }
    }catch(e){ setRes('sheets','fail', String(e)); }
  }

  async function testViewer(){
    try{
      const loaded = !!wrap.__viewerLoaded;
      if(loaded){ setRes('viewer','pass','model loaded'); }
      else { setRes('viewer','warn','model not loaded yet'); }
    }catch(e){ setRes('viewer','fail', String(e)); }
  }

  async function testPins(){
    try{
      // simulate bus traffic without touching real scene
      let added=false, selectedFired=false;
      const off1 = bus.on('pin:added', ()=>{ added=true; });
      const off2 = bus.on('pin:selected', ()=>{ selectedFired=true; });
      // Emit fake events
      bus.emit('pin:added', {id:'diag_pin'});
      bus.emit('pin:selected', 'diag_pin');
      off1(); off2();
      if(added && selectedFired){ setRes('pins','pass','events ok'); }
      else { setRes('pins','fail','event bus not responding'); }
    }catch(e){ setRes('pins','fail', String(e)); }
  }

  async function runAll(){
    logEl.textContent = ''; // clear
    await testAuth();
    await testDriveList();
    await testHeic();
    await testSheets();
    await testViewer();
    await testPins();
  }

  btnAll.addEventListener('click', runAll);
  btnLog.addEventListener('click', ()=>{
    logEl.style.display = (logEl.style.display==='none'?'block':'none');
  });

  // Mark viewer loaded state
  bus.on('model:loaded', ()=>{ wrap.__viewerLoaded = true; });

  // auto run once after load (delay for gapi init)
  setTimeout(runAll, 800);
}
