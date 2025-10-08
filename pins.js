
import { ensureViewer, setPinColor, addPinAtCenter, clearPins, loadGLB } from './viewer.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const els = {
  tabs: document.querySelectorAll('.tab'),
  panes: document.querySelectorAll('.tabpane'),
  authBtn: document.getElementById('auth-btn'),
  glbInput: document.getElementById('glb-input'),
  glbLoad: document.getElementById('glb-load'),
  colors: document.querySelectorAll('#pin-colors .color'),
  add: document.getElementById('pin-add'),
  clear: document.getElementById('pin-clear'),
  title: document.getElementById('pin-title'),
  body: document.getElementById('pin-body'),
  refreshImgs: document.getElementById('images-refresh'),
  filter: document.getElementById('pin-filter'),
};

function initTabs() {
  els.tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      els.tabs.forEach(b=>b.classList.remove('active'));
      els.panes.forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
}

function initColors() {
  els.colors.forEach(btn => {
    btn.addEventListener('click', () => {
      els.colors.forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      const hex = btn.dataset.color;
      setPinColor(hex);
    });
  });
  // Activate first
  els.colors[0].click();
}

function initAuth() {
  setupAuth(els.authBtn, (signedIn, resp) => {
    console.log('[auth] toggled', signedIn);
    els.authBtn.textContent = signedIn ? 'Sign out' : 'Sign in';
  });
}

function initGLB() {
  els.glbLoad.addEventListener('click', async () => {
    const input = els.glbInput.value.trim() || 'demo';
    try {
      console.log('[GLB] load request', input, !!getAccessToken());
      await loadGLB(input);
    } catch (e) {
      console.error('[GLB] load failed', e);
      alert('GLB load failed: ' + e);
    }
  });
}

function initPins() {
  els.add.addEventListener('click', () => {
    addPinAtCenter(els.title.value, els.body.value);
  });
  els.clear.addEventListener('click', () => {
    clearPins();
  });
}

function boot() {
  ensureViewer();
  initTabs();
  initColors();
  initAuth();
  initGLB();
  initPins();
  console.log('[pins] ready');
}

boot();
