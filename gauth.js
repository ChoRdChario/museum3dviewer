// gauth.js — GIS (Google Identity Services) token flow; feeds token to gapi client
const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/spreadsheets'
].join(' ');

export function setupAuth({ chip, onReady, onSignedIn, onSignedOut }){
  let gapiReady = false;
  let gisReady = false;
  let tokenClient = null;
  let accessToken = null;
  let authed = false;

  function refreshChip(){
    chip.className = 'chip ' + (authed?'ok':'warn');
    chip.textContent = authed ? 'Signed' : 'Sign in';
  }
  refreshChip();

  async function loadGapiClient(){
    await new Promise(r => {
      if (window.gapi) return r();
      const t = setInterval(()=>{ if (window.gapi){ clearInterval(t); r(); } }, 50);
    });
    await new Promise(res => gapi.load('client', res));
    await gapi.client.init({
      apiKey: API_KEY,
      discoveryDocs: [
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        'https://sheets.googleapis.com/$discovery/rest?version=v4'
      ]
    });
    gapiReady = true;
  }

  async function loadGIS(){
    await new Promise(r => {
      const t = setInterval(()=>{ if (window.google?.accounts?.oauth2){ clearInterval(t); r(); } }, 50);
    });
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp) => {
        if (resp && resp.access_token){
          accessToken = resp.access_token;
          gapi.client.setToken({ access_token });
          authed = true;
          refreshChip();
          onSignedIn?.(null);
        } else {
          console.warn('[gauth] token response without access_token', resp);
        }
      }
    });
    gisReady = true;
  }

  async function ensureReady(){
    if (!gapiReady) await loadGapiClient();
    if (!gisReady) await loadGIS();
    onReady?.();
  }

  async function signIn(){
    await ensureReady();
    tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
  }

  async function signOut(){
    if (!accessToken){ return; }
    try { await new Promise((res)=> google.accounts.oauth2.revoke(accessToken, res)); } catch(e){}
    accessToken = null;
    gapi.client.setToken(null);
    authed = false;
    refreshChip();
    onSignedOut?.();
  }

  chip.addEventListener('click', async ()=>{
    try{ if (!authed) await signIn(); else await signOut(); }
    catch(e){ console.error('[gauth] click error', e); alert('Sign-in failed. See console.'); }
  });

  ensureReady();
  return {
    isSigned: ()=> authed,
    getAccessToken: ()=> accessToken
  };
}
