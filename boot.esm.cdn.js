// boot.esm.cdn.js (updated wiring for production UI)
import { ensureViewer, loadGlbFromUrl } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));

ensureViewer({ canvas: $('gl') });

const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('btnRefreshImages'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

const normalizeDrive = (v) => {
  if (!v) return '';
  const m = String(v).match(/[-\w]{25,}/);
  if (m) return `https://drive.google.com/uc?export=download&id=${m[0]}`;
  return v;
};
const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const url = normalizeDrive($('glbUrl')?.value || '');
  if (!url) return;
  try {
    $('btnGlb').disabled = true;
    await loadGlbFromUrl(url, { token });
  } finally {
    $('btnGlb').disabled = false;
  }
};
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e) => e.key === 'Enter' && doLoad());

const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#f97316','#84cc16','#14b8a6','#60a5fa','#c084fc','#eab308','#ef4444','#f472b6','#94a3b8'];
const pinColorsHost = $('pin-colors');
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  pinColorsHost.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    document.querySelectorAll('#pin-colors .chip').forEach(x=>x.style.outline='');
    b.style.outline = '2px solid #fff4';
    // TODO: connect to viewer.setPinColor(c)
  });
}

$('btnRefreshImages')?.addEventListener('click', () => console.log('[Images] refresh'));
$('save-target-create')?.addEventListener('click', () => console.log('[Sheet] create'));
signedSwitch(false);
console.log('[LociMyu ESM/CDN] boot complete');
