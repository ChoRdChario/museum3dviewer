// gauth.module.js — Google Identity Services token (scoped)
let accessToken = null;
let tokenClient = null;

const SCOPES = [
  'https://www.googleapis.com/auth/drive.file',       // create/update files you open/create with the app
  'https://www.googleapis.com/auth/spreadsheets',     // read/write Sheets
  'https://www.googleapis.com/auth/drive.readonly'    // read Drive metadata (optional)
].join(' ');

function ensureGisScript(){
  return new Promise((resolve)=>{
    if (window.google && window.google.accounts && window.google.accounts.oauth2){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ()=> resolve();
    s.onerror = ()=> resolve();
    document.head.appendChild(s);
  });
}

export function setupAuth(buttonEl, onSignedChange){
  (async ()=>{
    await ensureGisScript();
    if (!window.google?.accounts?.oauth2){
      console.warn('[auth] Google Identity Services not loaded; using stub');
      buttonEl?.addEventListener('click', ()=> console.warn('[auth] sign-in clicked (stub)'));
      return;
    }
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: window.GIS_CLIENT_ID || 'YOUR_CLIENT_ID.apps.googleusercontent.com',
      scope: SCOPES,
      prompt: 'consent',
      callback: (resp)=>{
        if (resp && resp.access_token){
          accessToken = resp.access_token;
          onSignedChange?.(true);
        } else {
          console.warn('[auth] token callback w/o access_token', resp);
        }
      }
    });
    buttonEl?.addEventListener('click', ()=>{
      tokenClient.requestAccessToken({ prompt: '' });
    });
  })();
}

export function getAccessToken(){ return accessToken; }
