// museum3dviewer/features/init_cloud_boot.js  (v6.6.5)
// 1行導入でUIを描画→GIS/GAPI準備→（存在すれば）Drive/Sheets配線を起動

import { ensureLoaded, initAuthUI } from './auth.js';

await initAuthUI();                      // まずUI描画（右上/右ペイン/タイトル横）
await ensureLoaded();                    // 次にGIS/GAPIを準備
window.dispatchEvent(new Event('lmy:auth-mount-inline')); // 念のため再描画

// Optional: captions wiring があれば起動（無ければ無視）
try {
  const m = await import('./wiring_captions.js');
  await (m.startCloudBootstrap?.());
} catch {}
