import { ensureViewer } from './viewer.js?v=20251004ui';
import { setupUI } from './ui.js?v=20251004ui';
import { setupPins } from './pins.js?v=20251004ui';
import { setupAuth } from './gauth.js?v=20251004ui';

const stage = document.getElementById('stage');
const spinner = document.getElementById('spinner');

const app = {
  viewer: null,
  auth: null,
  modelMat: null,
  state: {
    currentGLBId: null,
    selectedPin: null,
    unlit: false,
    doubleSide: false,
  }
};

(async () => {
  app.viewer = await ensureViewer({ mount: stage, spinner });
  app.auth = setupAuth({
    chip: document.getElementById('authChip'),
    onReady: () => console.log('[auth] ready'),
    onSignedIn: (user) => {
      // FIX: optional chaining typo removed
      try {
        const email = user?.getBasicProfile?.()?.getEmail?.() ?? '';
        console.log('[auth] signed in', email);
      } catch (e) {
        console.log('[auth] signed in');
      }
    },
    onSignedOut: () => console.log('[auth] signed out')
  });

  setupUI(app);
  setupPins(app);

  // auto-load from URL ?id=
  const params = new URLSearchParams(location.search);
  const id = params.get('id');
  if (id) {
    document.getElementById('fileIdInput').value = id;
    document.getElementById('btnLoad').click();
  } else {
    spinner?.remove();
  }
})();
