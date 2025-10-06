
import { ensureViewer } from './viewer.js?v=20251005';
import { setupUI } from './ui.js?v=20251005';
import { setupPins } from './pins.js?v=20251005';
import { setupAuth } from './gauth.js?v=20251005';

(async function boot(){
  const stage = document.getElementById('stage');
  const spinner = document.getElementById('spinner');

  const app = {
    viewer: null,
    auth: null,
    state: {
      currentGLBId: null,
      selectedPinId: null,
      unlit: false,
      doubleSide: false,
      whiteKey: { enabled: false, threshold: 0.95 },
    },
  };

  // 1) Viewer
  app.viewer = await ensureViewer({ mount: stage, spinner });
  window.app = app; // for console debug

  // 2) Auth chip (visual state toggles)
  const authChip = document.getElementById('authChip');
  app.auth = setupAuth({
    chip: authChip,
    onReady: () => console.log('[auth] ready'),
    onSignedIn: () => {
      console.log('[auth] signed in');
      authChip.textContent = 'Signed in';
      authChip.classList.add('ok');
    },
    onSignedOut: () => {
      console.log('[auth] signed out');
      authChip.textContent = 'Sign in';
      authChip.classList.remove('ok');
    },
  });

  // 3) UI wiring
  setupUI(app);
  setupPins(app);

  // 4) Auto-load from URL ?id=
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id) {
    document.getElementById('fileIdInput').value = id;
    document.getElementById('btnLoad').click();
  } else if (spinner) {
    spinner.remove();
  }
})();
