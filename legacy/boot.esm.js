
// boot.esm.js
// Drop-in ESM bootstrap that preserves existing DOM/layout.
// Replace your old <script> includes with: <script type="module" src="./boot.esm.js"></script>

import * as THREE from './lib/three/build/three.module.js';
import { OrbitControls } from './lib/three/examples/jsm/controls/OrbitControls.js';
import { ensureViewer, loadGlbFromUrl } from './viewer.module.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const q = (ids) => ids.map(id => document.getElementById(id)).find(el => !!el);

// Try common IDs without changing your HTML:
const canvas = q(['gl','stage','viewer-canvas']);
const btnAuth = q(['auth-toggle','auth-signin','btnSignIn','btn-login']);
const btnGlb  = q(['btnGlb','glbButton','glb-open','btn-open-glb']);
const inputGlb= q(['glbUrl','glb-url','fieldId','input-glb-url']);
const btnRefreshImg = q(['btnRefreshImages','refreshImages']);

const root = document.documentElement;

if (!canvas) console.warn('[LociMyu ESM] Canvas element not found (expected one of #gl, #stage, #viewer-canvas)');

ensureViewer({ canvas, THREE, OrbitControls });

// Auth wiring (existing gauth.module.js is reused)
if (btnAuth) {
  setupAuth(btnAuth, (signedIn) => {
    root.classList.toggle('signed-in', signedIn);
    [btnGlb, btnRefreshImg, inputGlb].forEach(el => { if (el) el.disabled = !signedIn; });
  });
}

// Normalize Drive URL/fileId into uc?export=download
const normalizeDrive = (v) => {
  if (!v) return '';
  const m = String(v).match(/[-\w]{25,}/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[0]}`;
  return v;
};

const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const url = normalizeDrive(inputGlb?.value || '');
  if (!url) return;
  try {
    btnGlb && (btnGlb.disabled = true);
    await loadGlbFromUrl(url, { token });
  } catch (e) {
    console.error('[GLB] load error', e);
  } finally {
    btnGlb && (btnGlb.disabled = false);
  }
};

btnGlb && btnGlb.addEventListener('click', doLoad);
inputGlb && inputGlb.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLoad(); });

// Initial disabled state until signed in
[btnGlb, btnRefreshImg, inputGlb].forEach(el => { if (el) el.disabled = true; });

console.log('[LociMyu ESM] boot complete');
