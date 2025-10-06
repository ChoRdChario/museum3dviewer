
// gauth.js — no UI injection; just wire existing button(s)
export async function setupAuth(app){
  const btn = document.querySelector('#auth-btn, [data-auth-btn]');
  if (!btn) {
    console.warn('[auth] no auth button found — add id="auth-btn" or data-auth-btn to a <button>.');
    // still create a no-op auth facade so app.viewer.loadByInput() can check
  }

  // Simple GIS OAuth (popup handled by script tag in index.html)
  let accessToken = null;

  function ensureGIS() {
    const hasGis = !!window.google && !!google.accounts && !!google.accounts.oauth2;
    const hasGapi = !!window.gapi;
    if (!hasGis || !hasGapi) throw new Error('Google scripts not ready');
  }

  function getAccessToken(){ return accessToken; }
  app.auth = { getAccessToken };

  if (btn){
    btn.addEventListener('click', async ()=>{
      try{
        ensureGIS();
        // Initialize (client_id must be present in hosting page)
        const clientId = window.GOOGLE_CLIENT_ID || (window.__GOOGLE_CLIENT_ID && window.__GOOGLE_CLIENT_ID());
        if (!clientId) throw new Error('Missing GOOGLE_CLIENT_ID in page');
        const tokenClient = google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope: 'https://www.googleapis.com/auth/drive.readonly',
          callback: (resp)=>{
            accessToken = resp && resp.access_token || null;
            console.log('[auth] token granted');
          }
        });
        tokenClient.requestAccessToken({prompt: 'consent'});
      }catch(err){
        console.error('[auth] error', err);
        alert('Auth failed: ' + (err?.message||err));
      }
    });
  }
}
