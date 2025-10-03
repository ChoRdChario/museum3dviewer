// features/init_cloud_boot.js  (v6.6.3)
import { ensureLoaded, initAuthUI } from './auth.js';
await initAuthUI();        // draw UI now
await ensureLoaded();      // then prepare GIS/GAPI
try {
  const m = await import('./wiring_captions.js');
  await (m.startCloudBootstrap?.());
} catch {}
