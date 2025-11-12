
// save.locator.js (ESM) — v3.1
// Purpose: Given a GLB Drive fileId, find or create the LociMyu save Spreadsheet
// in the same Drive folder, ensure __LM_MATERIALS sheet exists + header, and pick
// the active caption sheet WITHOUT auto-creating "Captions".
//
// Exports:
//   - findOrCreateSaveSheetByGlbId({ glbId, glbName? }): Promise<{
//       spreadsheetId: string,
//       materialsGid: number,
//       captionGid: number,
//       defaultCaptionGid: number, // same as captionGid (for backward compat)
//     }>
//
// Expected environment:
//   - gauth.module.js: exports getAccessToken(): Promise<string>
//   - This file is imported via ESM: `import * as loc from './save.locator.js'`
//
// Notes:
//   - Uses native fetch with Authorization header (Bearer token).
//   - Does NOT auto-create a "Captions" sheet. It selects an existing non-__LM_MATERIALS sheet.
//   - If none exists, it falls back to the first sheet returned by Sheets API.
//   - __LM_MATERIALS: created if missing; header row ensured once.
//
// Logging prefix: [save.locator]

import * as gauth from './gauth.module.js';

const DRIVE_V3 = 'https://www.googleapis.com/drive/v3';
const SHEETS_V4 = 'https://sheets.googleapis.com/v4/spreadsheets';

const LM_MATERIALS_TITLE = '__LM_MATERIALS';
const LM_HEADER = [
  'materialKey', 'opacity', 'chromaColor', 'chromaTolerance', 'chromaFeather',
  'doubleSided', 'unlitLike', 'updatedAt', 'updatedBy'
];

async function fetchJSONAuth(url, opts = {}) {
  const token = await gauth.getAccessToken();
  const headers = {
    ...(opts.headers || {}),
    'Authorization': `Bearer ${token}`,
    'Content-Type': opts.body && typeof opts.body === 'string' ? 'application/json' : (opts.headers && opts.headers['Content-Type']) ? opts.headers['Content-Type'] : 'application/json',
  };
  const res = await fetch(url, { ...opts, headers });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[save.locator] fetch failed', url, res.status, text);
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }
  // Some Sheets batch endpoints return empty. Try JSON parse but allow empty.
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return null;
}

async function getDriveFile(fileId) {
  const url = `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?fields=id,name,parents,mimeType`;
  return fetchJSONAuth(url);
}

async function listSpreadsheetsInParent(parentId, nameHint) {
  // Search spreadsheets in parent; prefer name containing hint
  const q = [
    `'${parentId}' in parents`,
    `mimeType='application/vnd.google-apps.spreadsheet'`,
    `trashed=false`
  ].join(' and ');
  const url = `${DRIVE_V3}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=10&orderBy=modifiedTime desc`;
  const data = await fetchJSONAuth(url);
  const files = data.files || [];
  if (nameHint) {
    const hit = files.find(f => (f.name || '').toLowerCase().includes(nameHint.toLowerCase()));
    if (hit) return hit;
  }
  return files[0] || null;
}

async function createSpreadsheet(title) {
  const payload = {
    properties: { title },
    sheets: [{ properties: { title: 'Sheet1' } }]
  };
  const url = `${SHEETS_V4}`;
  const data = await fetchJSONAuth(url, { method: 'POST', body: JSON.stringify(payload) });
  return data; // { spreadsheetId, sheets: [{properties:{sheetId,title}}], ... }
}

async function moveFileToParent(fileId, newParentId) {
  // Need to add new parent and remove old parents (if any). First get parents.
  const file = await getDriveFile(fileId);
  const oldParents = (file.parents || []).join(',');
  const url = `${DRIVE_V3}/files/${encodeURIComponent(fileId)}?addParents=${encodeURIComponent(newParentId)}${oldParents ? `&removeParents=${encodeURIComponent(oldParents)}` : ''}&fields=id,parents`;
  return fetchJSONAuth(url, { method: 'PATCH' });
}

async function getSpreadsheet(spreadsheetId) {
  const url = `${SHEETS_V4}/${encodeURIComponent(spreadsheetId)}?includeGridData=false`;
  return fetchJSONAuth(url);
}

async function batchUpdate(spreadsheetId, requests) {
  const url = `${SHEETS_V4}/${encodeURIComponent(spreadsheetId)}:batchUpdate`;
  return fetchJSONAuth(url, { method: 'POST', body: JSON.stringify({ requests }) });
}

async function valuesGet(spreadsheetId, rangeA1) {
  const url = `${SHEETS_V4}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}`;
  return fetchJSONAuth(url);
}

async function valuesUpdate(spreadsheetId, rangeA1, values) {
  const url = `${SHEETS_V4}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`;
  return fetchJSONAuth(url, { method: 'PUT', body: JSON.stringify({ values }) });
}

function pickCaptionSheet(sheets) {
  // Policy:
  // 1) Prefer a sheet named "Captions" (do NOT create; just pick if exists)
  // 2) Otherwise, pick the first sheet whose title !== __LM_MATERIALS
  // 3) Fallback: first sheet in the spreadsheet
  let candidate = sheets.find(s => (s.properties?.title || '') === 'Captions');
  if (candidate) return candidate.properties.sheetId;

  candidate = sheets.find(s => (s.properties?.title || '') !== LM_MATERIALS_TITLE);
  if (candidate) return candidate.properties.sheetId;

  const first = sheets[0];
  return first?.properties?.sheetId;
}

function ensureHeaderRowMatches(values, header) {
  if (!Array.isArray(values) || values.length === 0) return false;
  const row = values[0] || [];
  if (row.length < header.length) return false;
  for (let i = 0; i < header.length; i++) {
    if ((row[i] || '') !== header[i]) return false;
  }
  return true;
}

async function ensureMaterialsSheet(spreadsheet) {
  const sheets = spreadsheet.sheets || [];
  const hit = sheets.find(s => (s.properties?.title || '') === LM_MATERIALS_TITLE);
  if (hit) {
    console.log('[save.locator] __LM_MATERIALS exists', hit.properties.sheetId);
    // Verify header row
    try {
      const gr = await valuesGet(spreadsheet.spreadsheetId, `${LM_MATERIALS_TITLE}!A1:Z1`);
      const ok = ensureHeaderRowMatches(gr.values, LM_HEADER);
      if (!ok) {
        await valuesUpdate(spreadsheet.spreadsheetId, `${LM_MATERIALS_TITLE}!A1:Z1`, [LM_HEADER]);
        console.log('[save.locator] header fixed for __LM_MATERIALS');
      } else {
        console.log('[save.locator] header present -> SKIP');
      }
    } catch (e) {
      // If values.get failed (sheet might be empty), write header.
      await valuesUpdate(spreadsheet.spreadsheetId, `${LM_MATERIALS_TITLE}!A1:Z1`, [LM_HEADER]);
      console.log('[save.locator] header set for __LM_MATERIALS');
    }
    return hit.properties.sheetId;
  }

  // Create the materials sheet
  const addRes = await batchUpdate(spreadsheet.spreadsheetId, [{
    addSheet: { properties: { title: LM_MATERIALS_TITLE, gridProperties: { frozenRowCount: 1 } } }
  }]);
  // Retrieve fresh spreadsheet to get sheetId
  const updated = await getSpreadsheet(spreadsheet.spreadsheetId);
  const created = updated.sheets.find(s => (s.properties?.title || '') === LM_MATERIALS_TITLE);
  const sheetId = created?.properties?.sheetId;
  if (sheetId == null) throw new Error('Failed to create __LM_MATERIALS');
  console.log('[save.locator] __LM_MATERIALS created', sheetId);

  await valuesUpdate(spreadsheet.spreadsheetId, `${LM_MATERIALS_TITLE}!A1:Z1`, [LM_HEADER]);
  console.log('[save.locator] header set for __LM_MATERIALS');
  return sheetId;
}

/**
 * Main entrypoint: find or create the save spreadsheet near the GLB, ensure materials,
 * and decide the active caption sheet (without auto-creating it).
 */
export async function findOrCreateSaveSheetByGlbId({ glbId, glbName }) {
  console.log('[save.locator] module loaded (ESM export active)');
  console.log('[save.locator] begin', { glbId, glbName });

  if (!glbId) throw new Error('glbId is required');

  // 1) Locate GLB file parents
  const glb = await getDriveFile(glbId);
  const parentId = (glb.parents && glb.parents[0]) || null;
  const nameHint = (glbName || glb.name || 'LociMyu').trim();
  if (!parentId) console.warn('[save.locator] GLB has no parent; spreadsheet will be created in My Drive');

  // 2) Find existing spreadsheet in the same folder (prefer name containing hint)
  let spreadsheetFile = parentId ? await listSpreadsheetsInParent(parentId, nameHint) : null;

  // 3) Create spreadsheet if none
  let spreadsheetId;
  if (!spreadsheetFile) {
    const title = `${nameHint} — LociMyu Save`;
    const created = await createSpreadsheet(title);
    spreadsheetId = created.spreadsheetId;
    console.log('[save.locator] spreadsheet created', spreadsheetId, title);
    // Move into same parent folder as GLB (if possible)
    if (parentId) {
      try {
        await moveFileToParent(spreadsheetId, parentId);
        console.log('[save.locator] spreadsheet moved to GLB parent', parentId);
      } catch (e) {
        console.warn('[save.locator] moving spreadsheet to GLB parent failed (will stay in My Drive):', e?.message || e);
      }
    }
  } else {
    spreadsheetId = spreadsheetFile.id;
    console.log('[save.locator] spreadsheet located', spreadsheetId, spreadsheetFile.name);
  }

  // 4) Ensure __LM_MATERIALS exists + header
  const doc = await getSpreadsheet(spreadsheetId);
  const materialsGid = await ensureMaterialsSheet(doc);

  // 5) Decide caption sheet (do not create)
  const fresh = await getSpreadsheet(spreadsheetId);
  const captionGid = pickCaptionSheet(fresh.sheets || []);
  if (captionGid == null) {
    // Extremely unlikely (no sheets at all). Create a basic Sheet1 to avoid null.
    await batchUpdate(spreadsheetId, [{ addSheet: { properties: { title: 'Sheet1' } } }]);
    const after = await getSpreadsheet(spreadsheetId);
    const fallback = pickCaptionSheet(after.sheets || []);
    console.log('[save.locator] caption sheet auto-fallback -> Sheet1', fallback);
    return {
      spreadsheetId,
      materialsGid,
      captionGid: fallback,
      defaultCaptionGid: fallback,
    };
  }

  console.log('[save.locator] active caption sheet ->', captionGid);
  return {
    spreadsheetId,
    materialsGid,
    captionGid,
    defaultCaptionGid: captionGid, // backward compatibility
  };
}

export default {
  findOrCreateSaveSheetByGlbId,
};
