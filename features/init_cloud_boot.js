// features/init_cloud_boot.js  (UI bootstrap for Cloud panel)
import { initAuthUI } from './auth.js';
import { startCloudBootstrap, bootstrapWithIdFromInput } from './wiring_captions.js';

// 1) Auth UI (kept at header-right by existing renderAuthUi)
initAuthUI();

// 2) Ensure a small Cloud box exists under the title.
function ensureCloudBox() {
  let cloud = document.getElementById('lmy-cloud-box');
  if (cloud) return cloud;

  cloud = document.createElement('div');
  cloud.id = 'lmy-cloud-box';
  cloud.style.cssText = [
    'position:relative',
    'max-width:460px',
    'margin:12px 0 0 0',
    'padding:10px 12px',
    'border-radius:10px',
    'background:rgba(255,255,255,0.035)',
    'border:1px solid rgba(255,255,255,0.08)',
    'font-size:12px',
    'line-height:1.5'
  ].join(';');

  const h = document.querySelector('h1, .app-title') || document.body.firstElementChild;
  if (h && h.parentNode) h.parentNode.insertBefore(cloud, h.nextSibling);
  else document.body.prepend(cloud);
  return cloud;
}

function renderCloudPanel() {
  const box = ensureCloudBox();
  // Render once
  if (box.dataset.mounted) return;
  box.dataset.mounted = '1';

  box.innerHTML = `
    <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
      <strong style="font-size:12px; opacity:.85;">Cloud</strong>
      <span style="opacity:.55;">GLB id/URL を入力して Start</span>
    </div>
    <div style="display:flex; gap:8px;">
      <input id="cloud_glb_id" type="text" placeholder="GLB id or URL"
             style="flex:1; min-width:220px; padding:6px 8px; border-radius:8px;
                    background:#0f0f10; border:1px solid rgba(255,255,255,.10);
                    color:#e8e8e8; outline:none;">
      <button id="cloud_glb_start"
              style="padding:6px 10px; border-radius:8px; border:1px solid rgba(255,255,255,.15);
                     background:#1f1f24; color:#e8e8e8; cursor:pointer;">Start</button>
    </div>
    <div id="cloud_hint" style="opacity:.55; margin-top:6px;">
      ?id= が無い場合でも URL / &lt;id&gt; / 生のID をそのまま入れられます。
    </div>
  `;

  box.querySelector('#cloud_glb_start').addEventListener('click', () => {
    bootstrapWithIdFromInput();
  });
}

// Auto-render after DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', renderCloudPanel);
} else {
  renderCloudPanel();
}

// Optional: support ?id= immediate start
window.addEventListener('load', () => {
  const id = new URLSearchParams(location.search).get('id');
  if (id) startCloudBootstrap(id);
});
