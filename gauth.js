// gauth.js — lightweight OAuth via Google Identity Services
console.log('[auth] module loaded');

let ACCESS_TOKEN = null;

function ensureLoaded(){
  const hasGis = !!(window.google && google.accounts && google.accounts.oauth2);
  const hasGapi = !!window.gapi;
  return hasGis && hasGapi;
}

// Initialize gapi if needed
function initGapi(){
  return new Promise((resolve)=>{
    if (window.gapi && gapi.client) return resolve();
    const tick = ()=>{
      if (window.gapi && gapi.client){ resolve(); }
      else requestAnimationFrame(tick);
    };
    tick();
  });
}

export async function signIn({clientId, scopes}){
  await initGapi();
  if (!ensureLoaded()) throw new Error('Google libraries not ready');
  return new Promise((resolve, reject)=>{
    google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: scopes.join(' '),
      callback: (resp)=>{
        if (resp.error){ reject(resp); return; }
        ACCESS_TOKEN = resp.access_token;
        resolve(ACCESS_TOKEN);
      },
    }).requestAccessToken();
  });
}

export function getAccessToken(){ return ACCESS_TOKEN; }
export function isSignedIn(){ return !!ACCESS_TOKEN; }
