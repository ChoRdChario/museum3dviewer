
const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly','https://www.googleapis.com/auth/spreadsheets'].join(' ');

export function setupAuth({ chip, onReady, onSignedIn, onSignedOut }){
  let gapiReady=false, gisReady=false, tokenClient=null, accessToken=null, authed=false;

  function refreshChip(){
    chip.textContent = authed ? 'Signed in' : 'Sign in';
  }

  async function loadGapiClient(){
    await new Promise(r => { const t=setInterval(()=>{ if (window.gapi?.load){ clearInterval(t); r(); } }, 50); });
    await new Promise(r => {
      gapi.load('client', async ()=>{
        await gapi.client.init({ apiKey: API_KEY, discoveryDocs: [
          'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
          'https://sheets.googleapis.com/$discovery/rest?version=v4'
        ]});
        gapiReady=true; onReady?.();
      });
    });
  }

  async function loadGIS(){
    await new Promise(r => { const t=setInterval(()=>{ if (window.google?.accounts?.oauth2){ clearInterval(t); r(); } }, 50); });
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPES,
      callback: (resp)=>{
        if (resp?.access_token){
          accessToken = resp.access_token;
          gapi.client.setToken({ access_token });
          authed = true; refreshChip(); onSignedIn?.();
        }
      }
    });
    gisReady=true;
  }

  async function ensureReady(){ if (!gapiReady) await loadGapiClient(); if (!gisReady) await loadGIS(); }
  async function signIn(){ await ensureReady(); tokenClient.requestAccessToken({ prompt: 'consent' }); }
  async function signOut(){ gapi.client.setToken(null); authed=false; refreshChip(); onSignedOut?.(); }

  chip.addEventListener('click', async ()=>{ try { if (!authed) await signIn(); else await signOut(); } catch(e){ console.error(e); } });

  ensureReady();
  return { isSigned: ()=>authed, getAccessToken: ()=>accessToken };
}
