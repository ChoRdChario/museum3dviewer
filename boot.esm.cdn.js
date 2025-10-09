// boot.esm.cdn.js — ESM/CDN bootstrap (Drive API loader, Sheets picker/Create, UI tweaks)
import { ensureViewer, loadGlbFromDrive } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });

// ---------- Auth wiring ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- GLB load (Drive API) ----------
const extractDriveId = (v) => {
  if (!v) return null;
  const m = String(v).match(/[-\w]{25,}/);
  return m ? m[0] : null;
};

let lastGlbFileId = null;

const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }
  const raw = $('glbUrl')?.value?.trim();
  const fileId = extractDriveId(raw);
  if (!fileId) { console.warn('[GLB] no fileId found in input'); return; }
  try {
    $('btnGlb').disabled = true;
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;
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

const pinColorsHost = $('pin-colors');
let currentPinColor = COLORS[0];
if (pinColorsHost) {
  pinColorsHost.innerHTML = COLORS.map(c => `<button class="chip" data-color="${c}" title="${c}" style="background:${c}"></button>`).join('');
  const select = (el) => {
    pinColorsHost.querySelectorAll('.chip').forEach(x => x.style.outline = '');
    el.style.outline = '2px solid #fff4';
    currentPinColor = el.dataset.color;
  };
  pinColorsHost.addEventListener('click', (e) => {
    const b = e.target.closest('[data-color]'); if (!b) return;
    select(b);
  });
  const first = pinColorsHost.querySelector('.chip'); first && select(first);
}

const pinFilterHost = $('pin-filter');
const selectedColors = new Set(COLORS);
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

// ---------- Refresh images (Drive parent folder enumeration) ----------
async function listImagesForGlb(fileId, token) {
  if (!fileId) throw new Error('fileId required');
  // 1) get parents
  const metaRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!metaRes.ok) throw new Error(`Drive meta failed: ${metaRes.status}`);
  const meta = await metaRes.json();
  const parent = Array.isArray(meta.parents) && meta.parents[0];
  if (!parent) return [];
  // 2) list images under parent
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink,webViewLink)&pageSize=100&supportsAllDrives=true`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) throw new Error(`Drive list failed: ${listRes.status}`);
  const data = await listRes.json();
  return data.files || [];
}

$('btnRefreshImages')?.addEventListener('click', async () => {
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value || '');
  if (!token || !fileId) {
    $('images-status').textContent = 'Sign in & load a GLB first.';
    return;
  }
  $('images-status').textContent = 'Listing images…';
  try {
    const files = await listImagesForGlb(fileId, token);
    $('images-status').textContent = `${files.length} image(s) found in the GLB folder`;
    console.log('[Drive images]', files);
  } catch (e) {
    $('images-status').textContent = `Error: ${e.message}`;
    console.error('[Drive images] error', e);
  }
});

// ---------- Sheets: picker (via Drive list) & create (via Sheets API) ----------
async function populateSheets() {
  const token = getAccessToken();
  if (!token) return;
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false");
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100&supportsAllDrives=true`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return;
  const data = await res.json();
  const sel = $('save-target-sheet');
  if (!sel) return;
  sel.innerHTML = `<option value="">Select sheet…</option>` + (data.files||[]).map(f => `<option value="${f.id}">${f.name}</option>`).join('');
}

$('save-target-create')?.addEventListener('click', async () => {
  const token = getAccessToken();
  if (!token) return;
  const title = `LociMyu_${new Date().toISOString().replace(/[:.]/g,'-')}`;
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ properties: { title } })
  });
  if (!res.ok) {
    const t = await res.text().catch(()=>'');
    console.error('[Sheets create] failed', res.status, t);
    return;
  }
  const sheet = await res.json();
  await populateSheets();
  const sel = $('save-target-sheet');
  if (sel) { sel.value = sheet.spreadsheetId; }
});

document.addEventListener('DOMContentLoaded', () => populateSheets());
document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && populateSheets());

// initial state
signedSwitch(false);
console.log('[LociMyu ESM/CDN] boot complete');
