// ui.js — keep layout; add captions wiring
import { getAccessToken, signIn, autoBindSigninButton } from './gauth.js';
import { createViewer, fetchDriveArrayBuffer } from './viewer.js';
import { wireCaptions } from './ui.captions.patch.js';

console.log('[ui] module loaded');

const canvas = document.getElementById('viewer') || document.querySelector('canvas#viewer') || document.querySelector('canvas');
let viewer = null;
(async ()=>{
  if (canvas){
    viewer = await createViewer(canvas);
    // Wire captions tab on top of existing UI
    wireCaptions(viewer);
  }
})();

// Auth
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function setAuthStatus(ok){
  const statusEls = ['#auth-status','.auth-status','[data-role="auth-status"]'].map(s=>document.querySelector(s)).filter(Boolean);
  statusEls.forEach(el=> el.textContent = ok ? 'Signed in' : 'Signed out');
}
autoBindSigninButton({
  clientId: CLIENT_ID,
  scopes: SCOPES,
  onChange: (ok)=> setAuthStatus(ok)
});

// Loader wiring
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
