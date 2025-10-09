// boot.esm.cdn.js — ESM/CDN bootstrap
// - GLB: Drive API v3 で CORS安全に読み込み（済）
// - Images refresh（済）
// - ▼ 追加：GLBと同階層のスプレッドシート自動検出/自動作成（LociMyu形式）
// - ▼ 追加：セレクトは「同一スプシ内のシート(タブ)」列挙／Create は新規タブ追加

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
  const m = String(v).match(/[-\w]{25,}/);
  return m ? m[0] : null;
};

let lastGlbFileId = null;
let currentSpreadsheetId = null; // 同階層で見つかった/作成されたスプシ
let currentSheetId = null;       // セレクトで選んだタブ

const doLoad = async () => {
  const token = getAccessToken();
  if (!token) { console.warn('[GLB] token missing. Please sign in.'); return; }

  const raw = $('glbUrl')?.value?.trim();
  const fileId = extractDriveId(raw);
  if (!fileId) { console.warn('[GLB] no fileId found in input'); return; }

  try {
    $('btnGlb').disabled = true;

    // 1) GLB 読み込み
    await loadGlbFromDrive(fileId, { token });
    lastGlbFileId = fileId;

    // 2) 親フォルダ
    const parentId = await getParentFolderId(fileId, token);

    // 3) 同階層のスプシを LociMyu 形式で自動検出 → なければ作成
    currentSpreadsheetId = await findOrCreateLociMyuSpreadsheet(parentId, token, { glbId: fileId });

    // 4) タブ一覧をセレクトに反映（同一スプシ内のシート）
    await populateSheetTabs(currentSpreadsheetId, token);

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

// ---------- Drive: images under GLB's parent ----------
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

// ---------- Spreadsheet（同階層の自動検出/自動生成 + タブ選択/追加） ----------
const LOCIMYU_HEADERS = ['id','title','body','color','x','y','z'];      // 初期化時に入れる想定ヘッダ
const REQUIRED_MIN_HEADERS = new Set(['title','body','color']);         // LociMyu 形式ざっくり判定

// A1:Z1 を見て、どれかのシートに主要3列が揃っていれば LociMyu とみなす
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

// 同階層にスプシ作成（Drive API でフォルダ指定）→ ヘッダを1行だけ初期化
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

  // A1:Z1 にヘッダを書き込み（Sheet API）
  const valuesRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/A1:Z1?valueInputOption=RAW`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [LOCIMYU_HEADERS] })
  });
  if (!valuesRes.ok) console.warn('[Sheets] init headers failed', valuesRes.status, await valuesRes.text().catch(()=>''));  

  return spreadsheetId;
}

// 同階層のスプシを列挙 → LociMyu 形式のものを選択 → なければ作成
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
  // 見つからなければ新規作成
  const createdId = await createLociMyuSpreadsheet(parentFolderId, token, { glbId });
  console.log('[Sheets] created LociMyu spreadsheet:', createdId);
  return createdId;
}

// スプシ内のシート(タブ)一覧をセレクトに反映
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

// セレクトでタブ切り替え
$('save-target-sheet')?.addEventListener('change', (e) => {
  currentSheetId = e.target.value ? Number(e.target.value) : null;
});

// Create は「同一スプシ内に新規タブ追加」
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

// 初期状態
signedSwitch(false);
console.log('[LociMyu ESM/CDN] boot complete');
