
// boot.esm.cdn.js — materials bootstrap (auth/signin overlay & safe wiring)
// ========================================================================

import { setupAuth, getAccessToken, ensureToken, signIn } from './gauth.module.js';

console.log('[LociMyu ESM/CDN] boot clean full build loaded');
console.log('[materials] overlay applied LM-PATCH-A6');

// ---------- helper: mount a minimal sign-in button overlay (non-intrusive)
(function ensureSigninOverlay(){
  let btn = document.getElementById('__lmSignin');
  if (btn) return;
  btn = document.createElement('button');
  btn.id = '__lmSignin';
  btn.textContent = 'Google にサインイン';
  Object.assign(btn.style, {
    position:'fixed', right:'16px', top:'16px', zIndex: 99999,
    padding:'8px 12px', borderRadius:'8px', border:'1px solid #999',
    background:'#fff', cursor:'pointer', font:'12px/1.2 system-ui,sans-serif', boxShadow:'0 2px 6px rgba(0,0,0,.2)'
  });
  btn.addEventListener('click', async (e)=>{
    e.preventDefault();
    try{
      await signIn();
      btn.textContent = 'サインイン済み';
      btn.disabled = true;
      btn.style.opacity = '0.6';
      document.dispatchEvent(new Event('lm:signedin'));
    }catch(err){
      console.warn('[signin] failed:', err?.message || err);
    }
  });
  document.body.appendChild(btn);
})();

// ---------- auth bootstrap (does nothing until client_id が注入される場合あり)
(async () => {
  try {
    await setupAuth(); // client_id が無ければ待機するだけ
  } catch(e) {
    console.warn('[materials] setupAuth warn:', e?.message || e);
  }
})();

// ---------- materials bootOnce stub (kept for compatibility/logs)
(function bootOnce(){
  console.log('[materials] bootOnce');
})();

// ---------- minimal Sheets append demo wiring (kept from previous A6 but guarded)
window.__LM_materials = window.__LM_materials || {};
window.__LM_materials.saveRow = async function saveRow(spreadsheetId, values){
  try {
    // ensure token (interactive only if button pressed separately)
    const tok = await getAccessToken({interactiveIfNeeded:false});
    if (!tok) throw new Error('no token');

    const params = new URLSearchParams({
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      range: "'materials'!A2:K9999"
    });
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values:append?${params}`;

    const res = await fetch(url, {
      method:'POST',
      headers: {
        'Authorization': `Bearer ${tok}`,
        'Content-Type':'application/json'
      },
      body: JSON.stringify({ values: [values] })
    });
    if (!res.ok) {
      const tx = await res.text().catch(()=>'');
      throw new Error(`values.append ${res.status} ${tx}`);
    }
    console.log('[materials] saved row to materials');
  } catch (e) {
    console.warn('[materials] save failed', e);
    throw e;
  }
};

// Expose a helper to forcibly sign-in from console if UIが触れない場合
window.__LM_forceSignIn = async () => {
  try { await signIn(); console.log('[signin] OK'); } catch(e){ console.warn('[signin] NG', e); }
};
