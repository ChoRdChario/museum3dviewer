// boot.esm.cdn.js — ESM/CDN bootstrap (8-color palette, Drive API loader)
import { ensureViewer, loadGlbFromDrive } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });

// ---------- Auth wiring (GIS は gauth.module.js 側で動的ロード & メタから client_id を解決) ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('btnRefreshImages'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- GLB load (Drive API 経由; CORS 安全) ----------
const extractDriveId = (v) => {
  if (!v) return null;
  const m = String(v).match(/[-\w]{25,}/);
  return m ? m[0] : null;
};

const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const raw = $('glbUrl')?.value?.trim();
  const fileId = extractDriveId(raw);
  if (!fileId) { console.warn('[GLB] no fileId found in input'); return; }
  try {
    $('btnGlb').disabled = true;
    await loadGlbFromDrive(fileId, { token });
  } catch (e) {
    console.error('[GLB] load error', e);
  } finally {
    $('btnGlb').disabled = false;
  }
};
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e) => e.key === 'Enter' && doLoad());

// ---------- Caption: 8-color palette + checkbox filter ----------
const COLORS = ['#ff6b6b','#ffd93d','#6bcb77','#4d96ff','#9b5de5','#f15bb5','#00c2a8','#94a3b8'];

// (A) Pin color palette
const pinColorsHost = $('pin-colors');
let currentPinColor = COLORS[0];
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => {
    pinColorsHost.querySelectorAll('.chip').forEach(x => x.style.outline = '');
    el.style.outline = '2px solid #fff4';
    currentPinColor = el.dataset.color;
    // TODO: viewer.setDraftPinColor(currentPinColor)
  };
  pinColorsHost.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    select(b);
  });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}

// (B) Color filter checkboxes（選択色のみ表示させるためのイベント発火）
const pinFilterHost = $('pin-filter');
const selectedColors = new Set(COLORS); // default show-all
if (pinFilterHost) {
  pinFilterHost.innerHTML = COLORS.map(c => (
    `<label style="display:flex;align-items:center;gap:6px;margin:2px 8px 2px 0">
       <input type="checkbox" data-color="${c}" checked />
       <span class="chip" style="width:14px;height:14px;background:${c}"></span>
     </label>`
  )).join('');
  pinFilterHost.addEventListener('change', (e) => {
    const cb = e.target.closest('input[type=checkbox][data-color]'); if (!cb) return;
    const color = cb.dataset.color;
    cb.checked ? selectedColors.add(color) : selectedColors.delete(color);
    document.dispatchEvent(new CustomEvent('pinFilterChange', {
      detail: { selected: Array.from(selectedColors) }
    }));
  });
}

// ---------- Caption buttons (stubs; 後で pins.js に結線) ----------
$('pin-add')?.addEventListener('click', () => {
  console.log('[Pin] add (color=%s, title=%s, body=%s)',
    currentPinColor, $('caption-title')?.value, $('caption-body')?.value);
});
$('pin-clear')?.addEventListener('click', () => {
  if ($('caption-title')) $('caption-title').value = '';
  if ($('caption-body')) $('caption-body').value = '';
});

// initial state: disabled until signed in
signedSwitch(false);

console.log('[LociMyu ESM/CDN] boot complete');
