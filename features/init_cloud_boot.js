// features/init_cloud_boot.js  (v6.6.1)
// One-liner module you can include at the end of <body>.
// It ensures GIS/GAPI loaded, shows auth bar, and starts Drive/Sheets bootstrap.

import { ensureLoaded, initAuthUI } from './auth.js';
import { startCloudBootstrap } from './wiring_captions.js';

// Wait for GIS/GAPI, then show auth UI, then kick the cloud bootstrap.
// This runs regardless of script loading race conditions.
await ensureLoaded();
await initAuthUI();
startCloudBootstrap();
