const API_KEY = 'AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI';
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets';

export function setupAuth({ chip, onReady, onSignedIn, onSignedOut }){
  let gapiLoaded = false, authed = false;

  chip.addEventListener('click', async ()=>{
    if (!gapiLoaded) await loadGapi();
    if (!authed) { await signIn(); } else { await signOut(); }
    refreshChip();
  });

  function refreshChip(){
    chip.className = 'chip ' + (authed?'ok':'warn');
    chip.textContent = authed ? 'Signed' : 'Sign in';
  }

  async function loadGapi(){
    await new Promise(r => setTimeout(r, 200)); // allow script to attach
    if (!window.gapi){ console.warn('[gauth] gapi not present; running in no-auth mode'); onReady?.(); return;}
    await new Promise((res)=> gapi.load('client:auth2', res));
    await gapi.client.init({ apiKey: API_KEY, clientId: CLIENT_ID, scope: SCOPES, discoveryDocs: [
      'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
      'https://sheets.googleapis.com/$discovery/rest?version=v4'
    ]});
    gapiLoaded = true;
    const auth = gapi.auth2.getAuthInstance();
    authed = auth.isSignedIn.get();
    auth.isSignedIn.listen((v)=>{ authed=v; refreshChip(); if(v) onSignedIn?.(auth.currentUser.get()); else onSignedOut?.(); });
    refreshChip();
    onReady?.();
  }

  async function signIn(){
    if (!window.gapi){ alert('Offline demo mode: gapi unavailable'); return; }
    await gapi.auth2.getAuthInstance().signIn();
    onSignedIn?.(gapi.auth2.getAuthInstance().currentUser.get());
    authed = true;
  }
  async function signOut(){
    if (!window.gapi){ return; }
    await gapi.auth2.getAuthInstance().signOut();
    onSignedOut?.();
    authed = false;
  }

  refreshChip();
  return {
    isSigned: ()=> authed,
  };
}
