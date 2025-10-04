// Google auth wiring with GIS + gapi v3
let accessToken = null;
let userEmail = null;
let tokenClient = null;
let gapiReady = false;

function qs(sel){ return document.querySelector(sel); }
function refreshChip(){
  const chip = qs('#authChip');
  if (!chip) return;
  if (accessToken){
    chip.classList.remove('warn');
    chip.textContent = userEmail ? userEmail : 'Signed in';
    chip.title = 'Click to sign out';
  }else{
    chip.classList.add('warn');
    chip.textContent = 'Sign in';
    chip.title = 'Sign in with Google';
  }
}

async function initGapi(apiKey){
  await new Promise((resolve)=>{
    function gapiLoad(){
      if (!window.gapi) { setTimeout(gapiLoad, 50); return; }
      window.gapi.load('client', async ()=>{
        await window.gapi.client.init({ apiKey });
        gapiReady = true;
        resolve();
      });
    }
    gapiLoad();
  });
}

export async function setupAuth({clientId, apiKey, scopes}){
  const chip = qs('#authChip');
  refreshChip();

  await initGapi(apiKey);

  await new Promise((resolve)=>{
    function init(){
      if (!google || !google.accounts || !google.accounts.oauth2){ setTimeout(init, 50); return; }
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: scopes.join(' '),
        prompt: '',
        callback: (resp)=>{
          if (resp && resp.access_token){
            accessToken = resp.access_token;
            userEmail = resp && resp.id_token ? JSON.parse(atob(resp.id_token.split('.')[1])).email : null;
            refreshChip();
          }
        }
      });
      resolve();
    }
    init();
  });

  chip?.addEventListener('click', async ()=>{
    if (!accessToken){
      tokenClient.requestAccessToken({prompt:'consent'});
    }else{
      // sign out
      accessToken = null;
      userEmail = null;
      refreshChip();
    }
  });
}

export function getAccessToken(){ return accessToken; }
export function isSignedIn(){ return !!accessToken; }
