// museum3dviewer/features/init_cloud_boot.js  (v6.6.6 - unchanged logic)
import { ensureLoaded, initAuthUI } from './auth.js';
await initAuthUI();            // draw inline chip
await ensureLoaded();          // prepare GIS/GAPI
window.dispatchEvent(new Event('lmy:auth-mount-inline')); // harmless
try { const m = await import('./wiring_captions.js'); await (m.startCloudBootstrap?.()); } catch {}
