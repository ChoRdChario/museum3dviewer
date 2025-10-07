// ui.js — keep UI layout intact; only wire auth & loaders defensively
import { getAccessToken, signIn, autoBindSigninButton } from './gauth.js';
import { createViewer, fetchDriveArrayBuffer } from './viewer.js';

console.log('[ui] module loaded');

// Try to detect existing DOM structure without altering it
const canvas = document.getElementById('viewer') || document.querySelector('canvas#viewer') || document.querySelector('canvas');
let viewer = null;
(async ()=>{ if (canvas) viewer = await createViewer(canvas); })();

// Auth: don't assume a specific button id; bind if found, also expose manual API.
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function setAuthStatus(ok){
  // Update common status elements if they exist; otherwise noop.
  const statusEls = ['#auth-status','.auth-status','[data-role="auth-status"]'].map(s=>document.querySelector(s)).filter(Boolean);
  statusEls.forEach(el=> el.textContent = ok ? 'Signed in' : 'Signed out');
}

autoBindSigninButton({
  clientId: CLIENT_ID,
  scopes: SCOPES,
  onChange: (ok)=> setAuthStatus(ok)
});

// Also listen for custom events so legacy HTML can trigger sign-in without changing markup.
document.addEventListener('locimyu:signin', async ()=>{
  const ok = await signIn({clientId: CLIENT_ID, scopes: SCOPES}).then(()=>true).catch(()=>false);
  setAuthStatus(ok);
});

// Loader wiring: try to find pre-existing controls
const fileIdInput = document.querySelector('#fileId, input[name="fileId"], input[data-role="fileId"]');
const btnLoad = document.querySelector('#btnLoad, button[data-role="load"], button.load');

if (btnLoad && fileIdInput){
  btnLoad.addEventListener('click', async ()=>{
    if (!viewer){ alert('viewer not ready'); return; }
    const token = getAccessToken();
    if (!token){ alert('Sign in first'); return; }
    const fileId = fileIdInput.value.trim();
    if (!fileId){ alert('fileId is empty'); return; }
    try{
      const ab = await fetchDriveArrayBuffer(fileId, token);
      await viewer.loadGLBFromArrayBuffer(ab);
    }catch(err){
      console.error(err);
      alert('Load failed: ' + err.message);
    }
  });
}
