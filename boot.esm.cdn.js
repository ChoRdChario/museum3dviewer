
// boot.esm.cdn.js
// CDN-based ESM bootstrap (no local /lib/three needed).

import * as THREE from 'https://unpkg.com/three@0.155.0/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.155.0/examples/jsm/controls/OrbitControls.js';
import { ensureViewer, loadGlbFromUrl } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const q = (ids) => ids.map(id => document.getElementById(id)).find(el => !!el);

const canvas = q(['gl','stage','viewer-canvas']);
const btnAuth = q(['auth-toggle','auth-signin','btnSignIn','btn-login']);
const btnGlb  = q(['btnGlb','glbButton','glb-open','btn-open-glb']);
const inputGlb= q(['glbUrl','glb-url','fieldId','input-glb-url']);
const btnRefreshImg = q(['btnRefreshImages','refreshImages']);
const root = document.documentElement;

ensureViewer({ canvas, THREE, OrbitControls });

if (btnAuth) {
  setupAuth(btnAuth, (signedIn) => {
    root.classList.toggle('signed-in', signedIn);
    [btnGlb, btnRefreshImg, inputGlb].forEach(el => { if (el) el.disabled = !signedIn; });
  });
}

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
[btnGlb, btnRefreshImg, inputGlb].forEach(el => { if (el) el.disabled = true; });

console.log('[LociMyu ESM/CDN] boot complete');
