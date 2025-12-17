// init.ready.gate.js
// A small, defensive "readiness gate" to keep the UI in a safe loading state
// until async loads (sheet/captions/images) settle.
// Used by both Edit and Share.

const TAG = '[lm-ready-gate]';

function q(sel, root=document){ return root.querySelector(sel); }

function ensureStyles(){
  if (document.getElementById('lm-ready-gate-style')) return;
  const s = document.createElement('style');
  s.id = 'lm-ready-gate-style';
  s.textContent = `
    #ui.lm-busy { position: relative; }
    #ui.lm-busy > * { filter: saturate(0.95); }
    #lm-ui-busy-overlay {
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.25);
      backdrop-filter: blur(1px);
      display: none;
      align-items: center;
      justify-content: center;
      z-index: 9999;
      pointer-events: none;
    }
    #ui.lm-busy #lm-ui-busy-overlay { display: flex; }
    #lm-ui-busy-overlay .box {
      display:flex;
      align-items:center;
      gap:10px;
      padding:10px 12px;
      border:1px solid var(--line);
      border-radius:12px;
      background: rgba(22,24,27,0.92);
      color: var(--text);
      font: 13px/1.3 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;
      box-shadow: 0 12px 40px rgba(0,0,0,0.35);
      max-width: calc(100% - 24px);
    }
    #lm-ui-busy-overlay .spin {
      width: 14px; height: 14px;
      border: 2px solid rgba(255,255,255,0.20);
      border-top-color: rgba(255,255,255,0.85);
      border-radius: 50%;
      animation: lmspin 0.85s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes lmspin { to { transform: rotate(360deg); } }
    #lm-ui-busy-overlay .msg { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(s);
}

function ensureOverlay(){
  const ui = q('#ui');
  if (!ui) return null;
  ensureStyles();
  let ov = q('#lm-ui-busy-overlay', ui);
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'lm-ui-busy-overlay';
  ov.innerHTML = `<div class="box"><div class="spin"></div><div class="msg">Loading…</div></div>`;
  ui.appendChild(ov);
  return ov;
}

function setMessage(msg){
  try{
    const ui = q('#ui');
    const ov = ui ? q('#lm-ui-busy-overlay .msg', ui) : null;
    if (ov) ov.textContent = msg || 'Loading…';
  }catch(_e){}
}

function setUiDisabled(on){
  const ui = q('#ui');
  if (!ui) return;

  // Toggle disabled on interactive controls in #ui.
  const els = ui.querySelectorAll('button, input, select, textarea');
  els.forEach(el => {
    // Keep the overlay itself unaffected
    if (el.closest && el.closest('#lm-ui-busy-overlay')) return;

    if (on){
      if (!el.dataset) return;
      if (el.dataset.lmPrevDisabled == null) el.dataset.lmPrevDisabled = String(!!el.disabled);
      el.disabled = true;
    } else {
      if (!el.dataset) return;
      const prev = el.dataset.lmPrevDisabled;
      if (prev != null){
        el.disabled = (prev === 'true');
        delete el.dataset.lmPrevDisabled;
      } else {
        // If we didn't record state, do not guess.
      }
    }
  });

  if (on) ui.classList.add('lm-busy');
  else ui.classList.remove('lm-busy');

  try{ ui.setAttribute('aria-busy', on ? 'true' : 'false'); }catch(_e){}
}

function createGate(){
  let runId = 0;
  let expected = new Set();
  let done = new Set();
  let _resolve = null;
  let _promise = null;
  let _timer = null;

  function begin(keys, opt={}){
    runId++;
    expected = new Set(Array.isArray(keys) ? keys : []);
    done = new Set();
    const thisRun = runId;

    ensureOverlay();
    setMessage(opt.message || 'Loading…');
    setUiDisabled(true);

    if (_timer) { clearTimeout(_timer); _timer = null; }
    const timeoutMs = Math.max(1500, Number(opt.timeoutMs || 15000));
    _timer = setTimeout(() => {
      if (thisRun !== runId) return;
      const missing = [...expected].filter(k => !done.has(k));
      if (missing.length){
        console.warn(TAG, 'timeout; releasing UI with missing steps:', missing);
      }
      finish();
    }, timeoutMs);

    _promise = new Promise((res)=>{ _resolve = res; });

    try{
      document.dispatchEvent(new CustomEvent('lm:ready-gate-begin', { detail:{ runId, expected:[...expected] } }));
    }catch(_e){}

    console.log(TAG, 'begin', { runId, expected:[...expected] });
    return runId;
  }

  function mark(key){
    if (!key) return;
    if (!expected || !expected.size) return;
    if (!expected.has(key)) return;
    if (done.has(key)) return;
    done.add(key);
    try{ document.dispatchEvent(new CustomEvent('lm:ready-gate-mark', { detail:{ runId, key, done:[...done] } })); }catch(_e){}
    // Lightly update message for common steps
    if (key === 'glb') setMessage('Loading sheet…');
    if (key === 'sheet') setMessage('Loading captions…');
    if (key === 'captions') setMessage('Loading images…');

    if ([...expected].every(k => done.has(k))) finish();
  }

  function finish(){
    if (_timer) { clearTimeout(_timer); _timer = null; }
    setUiDisabled(false);
    const r = runId;
    const d = [...done];
    expected = new Set();
    done = new Set();
    try{ document.dispatchEvent(new CustomEvent('lm:ready-gate-done', { detail:{ runId:r, done:d } })); }catch(_e){}
    if (_resolve){ try{ _resolve({ runId:r, done:d }); }catch(_e){} }
    _resolve = null;
    console.log(TAG, 'done', { runId:r, done:d });
  }

  function wait(){
    return _promise || Promise.resolve({ runId, done:[...done] });
  }

  function getRunId(){ return runId; }

  return { begin, mark, finish, wait, setMessage, getRunId };
}

// Install (single instance)
if (!window.__LM_READY_GATE__){
  window.__LM_READY_GATE__ = createGate();
  try{ (window.__LM_DIAG?.loaded || (window.__LM_DIAG.loaded=[])).push('init.ready.gate.js'); }catch(_e){}
  console.log(TAG, 'armed');
}
