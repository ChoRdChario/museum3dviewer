// Boot orchestrator — keeps responsibilities small and defensive.
import { ensureViewer } from './viewer.js';
import { setupPins } from './pins.js';

async function boot() {
  try {
    console.debug('[auth] ready');

    // 1) Ensure 3D viewer mounts (before wiring pins)
    const viewer = ensureViewer({
      canvas: document.getElementById('viewer'),
      host: document.getElementById('viewer-host'),
    });

    // 2) Wire tabs (simple, accessible)
    setupTabs();

    // 3) Wire auth via existing gauth.module.js (bridged on window)
    await setupAuth();

    // 4) Pins UI (palette, filters, list, interactions)
    setupPins({ viewer });

  } catch (err) {
    console.error('[boot] failed', err);
  }
}

function setupTabs() {
  const tabs = [
    { tab: '#tab-captions', panel: '#panel-captions' },
    { tab: '#tab-materials', panel: '#panel-materials' },
    { tab: '#tab-views', panel: '#panel-views' },
  ];
  for (const { tab, panel } of tabs) {
    const tabEl = document.querySelector(tab);
    const panelEl = document.querySelector(panel);
    tabEl?.addEventListener('click', () => {
      for (const t of tabs) {
        const te = document.querySelector(t.tab);
        const pe = document.querySelector(t.panel);
        te?.setAttribute('aria-selected', String(t.tab === tab));
        pe?.setAttribute('aria-hidden', String(t.panel !== panel));
      }
    });
  }
}

async function setupAuth() {
  const gauth = window.__gauth;
  const chip = document.querySelector('[data-auth-chip], #auth-chip');
  const btn  = document.querySelector('[data-auth-button], #auth-btn');
  const status = document.querySelector('[data-auth-status], #auth-status');

  if (!gauth || !chip || !btn) {
    throw new Error('[gauth] bridge/elements not available');
  }

  chip.setAttribute('aria-busy', 'true');

  // Try to initialize using whatever API gauth exposes (defensive)
  let api = {};
  if (typeof gauth.setupAuth === 'function') {
    api = await gauth.setupAuth({ chipEl: chip, buttonEl: btn, statusEl: status }).catch(() => ({}));
  }
  // Fallbacks
  if (!api.signIn && typeof gauth.signIn === 'function') api.signIn = gauth.signIn;
  if (!api.signOut && typeof gauth.signOut === 'function') api.signOut = gauth.signOut;
  if (!api.isSignedIn && typeof gauth.isSignedIn === 'function') api.isSignedIn = gauth.isSignedIn;
  if (!api.getAccessToken && typeof gauth.getAccessToken === 'function') api.getAccessToken = gauth.getAccessToken;
  if (typeof gauth.onAuthStateChanged === 'function') {
    gauth.onAuthStateChanged((signedIn) => {
      chip.setAttribute('aria-busy', 'false');
      status && (status.textContent = signedIn ? 'サインイン済み' : '未サインイン');
      for (const id of ['btn-load-glb', 'btn-refresh-images', 'btn-open-drive']) {
        const el = document.getElementById(id);
        if (el) el.disabled = !signedIn;
      }
      console.debug('[auth] state', signedIn);
    });
  } else {
    // Polling fallback
    const apply = async () => {
      const signedIn = api.isSignedIn ? await api.isSignedIn() : false;
      chip.setAttribute('aria-busy', 'false');
      status && (status.textContent = signedIn ? 'サインイン済み' : '未サインイン');
      for (const id of ['btn-load-glb', 'btn-refresh-images', 'btn-open-drive']) {
        const el = document.getElementById(id);
        if (el) el.disabled = !signedIn;
      }
    };
    await apply();
    setInterval(apply, 2000);
  }

  // Button behavior (toggle)
  btn.addEventListener('click', async () => {
    try {
      chip.setAttribute('aria-busy', 'true');
      const signedIn = api.isSignedIn ? await api.isSignedIn() : false;
      if (signedIn && api.signOut) await api.signOut();
      else if (!signedIn && api.signIn) await api.signIn();
    } catch (e) {
      console.warn('[auth] click failed', e);
    } finally {
      chip.setAttribute('aria-busy', 'false');
    }
  });
}

boot();
