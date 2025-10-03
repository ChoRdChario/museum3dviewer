// features/init_cloud_boot.js  (v6.6.4)
// One-liner entry. Include this in index.html just before </body>:
//   <script type="module" src="./features/init_cloud_boot.js"></script>

import { ensureLoaded, initAuthUI } from './auth.js';

await initAuthUI();        // draw UIs now (floating + sidebar + inline)
await ensureLoaded();      // then load GIS/GAPI for sign-in

// Auto-mount inline again (in case DOM finished after UI)
window.dispatchEvent(new Event('lmy:auth-mount-inline'));

// Optionally bootstrap Drive/Sheets wiring if available
try {
  const m = await import('./wiring_captions.js');
  await (m.startCloudBootstrap?.());
} catch {}
