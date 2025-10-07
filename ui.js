// ui.js — tab wiring + material sliders
import { getAccessToken, signIn } from './gauth.js';
import { createViewer, fetchDriveArrayBuffer } from './viewer.js';

console.log('[ui] module loaded');

const tabs = Array.from(document.querySelectorAll('.tab'));
const panels = {
  captions: document.querySelector('#panel-captions'),
  materials: document.querySelector('#panel-materials'),
  views: document.querySelector('#panel-views'),
};
tabs.forEach(t=>t.addEventListener('click', ()=>{
  tabs.forEach(x=>x.classList.toggle('active', x===t));
  Object.entries(panels).forEach(([k,el])=> el.classList.toggle('hidden', t.dataset.tab!==k));
}));

const canvas = document.getElementById('viewer');
let viewer = null;
async function bootViewer(){
  viewer = await createViewer(canvas);
}
bootViewer();

// Auth
const authBtn = document.getElementById('auth-btn');
const authStatus = document.getElementById('auth-status');
const CLIENT_ID = '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
const SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function renderAuth(){
  authStatus.textContent = getAccessToken() ? 'Signed in' : 'Signed out';
  authBtn.textContent = getAccessToken() ? 'Re-auth' : 'Sign in';
}
authBtn.addEventListener('click', async ()=>{
  try{
    await signIn({clientId: CLIENT_ID, scopes: SCOPES});
    renderAuth();
  }catch(e){
    console.error(e);
    alert('Sign-in failed');
  }
});
renderAuth();

// Load GLB by fileId
const fileIdEl = document.getElementById('fileId');
document.getElementById('btnLoad').addEventListener('click', async ()=>{
  if (!getAccessToken()){ alert('Sign in first'); return; }
  const fileId = fileIdEl.value.trim();
  if (!fileId){ alert('fileId is empty'); return; }
  try{
    const ab = await fetchDriveArrayBuffer(fileId, getAccessToken());
    await viewer.loadGLBFromArrayBuffer(ab);
  }catch(err){
    console.error(err);
    alert('Load failed: ' + err.message);
  }
});

// Material sliders
function hook(id){
  const el = document.getElementById(id);
  el.addEventListener('input', ()=>{
    const h = parseFloat(document.getElementById('matHue').value);
    const s = parseFloat(document.getElementById('matSat').value);
    const l = parseFloat(document.getElementById('matLight').value);
    const opacity = parseFloat(document.getElementById('matOpacity').value);
    viewer.applyMaterialDelta({h,s,l,opacity});
  });
}
['matHue','matSat','matLight','matOpacity'].forEach(id=>hook(id));
