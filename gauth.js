// gauth.js — GIS-only token flow (no gapi.client dependency)
console.log('[auth] module loaded');

let ACCESS_TOKEN = null;

// Expose sign-in callable without touching UI layout.
export async function signIn({clientId, scopes}){
  await waitForGIS();
  return new Promise((resolve, reject)=>{
    try{
      const client = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        callback: (resp)=>{
          if (resp && resp.access_token){
            ACCESS_TOKEN = resp.access_token;
            resolve(ACCESS_TOKEN);
          }else{
            reject(resp || new Error('No access_token in response'));
          }
        }
      });
      client.requestAccessToken();
    }catch(err){
      reject(err);
    }
  });
}

export function getAccessToken(){ return ACCESS_TOKEN; }
export function isSignedIn(){ return !!ACCESS_TOKEN; }

function waitForGIS(){
  return new Promise((resolve)=>{
    const ready = ()=> (window.google && google.accounts && google.accounts.oauth2);
    if (ready()) return resolve();
    const t = setInterval(()=>{
      if (ready()){ clearInterval(t); resolve(); }
    }, 50);
  });
}

// Optional: helper to bind common buttons without changing HTML.
export function autoBindSigninButton(opts){
  const cands = [
    '#auth-btn','#btnSignIn','#btnSignin','#btnLogin',
    '[data-action="signin"]','[data-role="signin"]',
    'button.signin','button.login'
  ];
  const el = cands.map(sel=>document.querySelector(sel)).find(Boolean);
  if (!el) return;
  const { clientId, scopes, onChange } = opts;
  el.addEventListener('click', async ()=>{
    try{ await signIn({clientId, scopes}); onChange && onChange(true); }
    catch(e){ console.error('[auth] sign-in failed', e); onChange && onChange(false); }
  }, { once:false });
}

// Global hook if HTML already has onclick handlers.
window.locimyuSignIn = async function(clientId, scopes){
  try{ await signIn({clientId, scopes}); return true; }catch(e){ console.error(e); return false; }
};
