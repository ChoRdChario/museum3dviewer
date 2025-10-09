// boot.esm.cdn.js — images grid & caption attach + sheet-in-folder logic
import { ensureViewer, loadGlbFromDrive } from './viewer.module.cdn.js';
import { setupAuth, getAccessToken } from './gauth.module.js';

const $ = (id) => document.getElementById(id);
const enable = (on, ...els) => els.forEach(el => el && (el.disabled = !on));

// ---------- Viewer ----------
ensureViewer({ canvas: $('gl') });

// ---------- Auth ----------
const btnAuth = $('auth-signin');
const signedSwitch = (signed) => {
  document.documentElement.classList.toggle('signed-in', signed);
  enable(signed, $('btnGlb'), $('glbUrl'), $('save-target-sheet'), $('save-target-create'), $('btnRefreshImages'));
};
btnAuth && setupAuth(btnAuth, signedSwitch);

// ---------- GLB load (Drive API) ----------
const extractDriveId = (v) => {
  if (!v) return null;
  const m = String(v).match(/[-\\w]{25,}/);
  return m ? m[0] : null;
};

let lastGlbFileId = null;
let currentSpreadsheetId = null;
let currentSheetId = null;

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

    const parentId = await getParentFolderId(fileId, token);
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });
    await populateSheetTabs(currentSpreadsheetId, token);

    // シート準備後、自動で同階層の画像を列挙してグリッド表示
    await refreshImagesGrid();
  } catch (e) {
    console.error('[GLB] load error', e);
  } finally {
    $('btnGlb').disabled = false;
  }
};
$('btnGlb')?.addEventListener('click', doLoad);
$('glbUrl')?.addEventListener('keydown', (e) => e.key === 'Enter' && doLoad());

// ---------- Caption: colors & filter ----------
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

// ---------- Drive helpers ----------
async function getParentFolderId(fileId, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=parents&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`Drive meta failed: ${res.status}`);
  const meta = await res.json();
  const parent = Array.isArray(meta.parents) && meta.parents[0];
  return parent || null;
}

async function listImagesForGlb(fileId, token) {
  const parent = await getParentFolderId(fileId, token);
  if (!parent) return [];
  const q = encodeURIComponent(`'${parent}' in parents and (mimeType contains 'image/') and trashed=false`);
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,thumbnailLink)&pageSize=200&supportsAllDrives=true`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) throw new Error(`Drive list failed: ${listRes.status}`);
  const data = await listRes.json();
  return data.files || [];
}

async function fetchImageBlobUrl(fileId, token) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`media fetch failed: ${res.status}`);
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

// ---------- Images grid & caption attach ----------
let selectedImage = null; // {id, url}

async function refreshImagesGrid() {
  const token = getAccessToken();
  const fileId = lastGlbFileId || extractDriveId($('glbUrl')?.value || '');
  if (!token || !fileId) {
    $('images-status').textContent = 'Sign in & load a GLB first.';
    return;
  }
  $('images-status').textContent = 'Loading images…';
  const grid = $('images-grid');
  grid.innerHTML = '';
  selectedImage = null;

  try {
    const files = await listImagesForGlb(fileId, token);
    $('images-status').textContent = `${files.length} image(s) found in the GLB folder`;

    const CONC = 6;
    const queue = files.slice();
    const workers = new Array(Math.min(CONC, queue.length)).fill(0).map(async () => {
      while (queue.length) {
        const f = queue.shift();
        try {
          const url = await fetchImageBlobUrl(f.id, token);
          const btn = document.createElement('button');
          btn.className = 'thumb';
          btn.style.backgroundImage = `url(${url})`;
          btn.title = f.name;
          btn.dataset.id = f.id;
          btn.addEventListener('click', () => {
            grid.querySelectorAll('.thumb').forEach(x => x.dataset.selected = 'false');
            btn.dataset.selected = 'true';
            selectedImage = { id: f.id, url };
          });
          grid.appendChild(btn);
        } catch (e) {
          console.warn('thumb err', f, e);
        }
      }
    });
    await Promise.all(workers);
  } catch (e) {
    $('images-status').textContent = `Error: ${e.message}`;
    console.error('[images grid] error', e);
  }
}

$('btnRefreshImages')?.addEventListener('click', refreshImagesGrid);

// ---------- Sheets in same folder ----------
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z'];
const REQUIRED_MIN_HEADERS = new Set(['title','body','color']);

async function isLociMyuSpreadsheet(spreadsheetId, token) {
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?includeGridData=true&ranges=A1:Z1&fields=sheets(properties(title,sheetId),data(rowData(values(formattedValue))))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return false;
  const data = await res.json();
  if (!Array.isArray(data.sheets)) return false;
  for (const s of data.sheets) {
    const row = s.data?.[0]?.rowData?.[0]?.values || [];
    const headers = row.map(v => (v?.formattedValue || '').toString().trim().toLowerCase()).filter(Boolean);
    const set = new Set(headers);
    let ok = true;
    for (const h of REQUIRED_MIN_HEADERS) if (!set.has(h)) ok = false;
    if (ok) return true;
  }
  return false;
}

async function createLociMyuSpreadsheet(parentFolderId, token, { glbId } = {}) {
  const name = `LociMyu_Save_${glbId || ''}`.replace(/_+$/,'');
  const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: parentFolderId ? [parentFolderId] : undefined
    })
  });
  if (!createRes.ok) throw new Error(`Drive files.create failed: ${createRes.status}`);
  const file = await createRes.json();
  const spreadsheetId = file.id;

  const valuesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:Z1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [LOCIMYU_HEADERS] })
  });
  if (!valuesRes.ok) console.warn('[Sheets] init headers failed', valuesRes.status, await valuesRes.text().catch(()=>''));

  return spreadsheetId;
}

async function findOrCreateLociMyuSpreadsheet(parentFolderId, token, { glbId } = {}) {
  if (!parentFolderId) throw new Error('parentFolderId required');
  const q = encodeURIComponent(`'${parentFolderId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const listUrl = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=10&supportsAllDrives=true`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) throw new Error(`Drive list spreadsheets failed: ${listRes.status}`);
  const data = await listRes.json();
  const files = data.files || [];

  for (const f of files) {
    if (await isLociMyuSpreadsheet(f.id, token)) {
      console.log('[Sheets] found LociMyu spreadsheet:', f);
      return f.id;
    }
  }
  const createdId = await createLociMyuSpreadsheet(parentFolderId, token, { glbId });
  console.log('[Sheets] created LociMyu spreadsheet:', createdId);
  return createdId;
}

async function populateSheetTabs(spreadsheetId, token) {
  const sel = $('save-target-sheet');
  if (!sel || !spreadsheetId) return;
  sel.innerHTML = `<option value="">Loading…</option>`;
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets(properties(title,sheetId,index))`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { sel.innerHTML = `<option value="">(error)</option>`; return; }
  const data = await res.json();
  const sheets = (data.sheets || []).map(s => s.properties).sort((a,b)=>a.index-b.index);
  sel.innerHTML = sheets.map(p => `<option value="${p.sheetId}">${p.title}</option>`).join('');
  currentSheetId = sheets[0]?.sheetId || null;
  if (currentSheetId) sel.value = String(currentSheetId);
}

$('save-target-sheet')?.addEventListener('change', (e) => {
  currentSheetId = e.target.value ? Number(e.target.value) : null;
});

$('save-target-create')?.addEventListener('click', async () => {
  const token = getAccessToken();
  if (!token || !currentSpreadsheetId) return;
  const title = 'Sheet_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-');
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(currentSpreadsheetId)}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title } } }] })
  });
  if (!res.ok) {
    console.error('[Sheets addSheet] failed', res.status, await res.text().catch(()=>'')); return;
  }
  await populateSheetTabs(currentSpreadsheetId, token);
});

// ---------- Caption list UI & attach image ----------
function appendCaptionItem({title, body, imageUrl}) {
  const host = $('caption-list');
  const div = document.createElement('div');
  div.className = 'caption-item';
  div.innerHTML = `
    ${imageUrl ? `<img src="${imageUrl}" alt="">` : ''}
    <div>
      <div style="font-weight:600">${title || ''}</div>
      <div class="hint" style="white-space:pre-wrap">${body || ''}</div>
    </div>
  `;
  host.appendChild(div);
}

$('pin-add')?.addEventListener('click', () => {
  const title = $('caption-title')?.value || '';
  const body = $('caption-body')?.value || '';
  appendCaptionItem({ title, body, imageUrl: selectedImage?.url || '' });
});

$('pin-clear')?.addEventListener('click', () => {
  if ($('caption-title')) $('caption-title').value = '';
  if ($('caption-body')) $('caption-body').value = '';
});

// initial state
signedSwitch(false);
console.log('[LociMyu ESM/CDN] boot complete');
