// save.locator.js
// LociMyu Save Locator (v3.1)
// - Captions sheet is NOT auto-created anymore.
// - We now "resolve" an active caption sheet by priority:
//     1) previously used captionGid (when the spreadsheet is unchanged)
//     2) a sheet named "Captions"
//     3) the first non-__LM_MATERIALS sheet (e.g., 'Sheet1')
//
// - __LM_MATERIALS is still auto-ensured (created if missing).
// - Returns a stable object: { spreadsheetId, materialsGid, captionGid, defaultCaptionGid }
//   (defaultCaptionGid kept for backward compatibility — equal to captionGid)
//
// Dependencies expected in the host app:
//   - gauth.module.js: export async function getAccessToken()
//   - Environment already includes fetch (browser).
//
// Notes:
//   - We keep logs with a consistent prefix: [save.locator]
//   - Google API calls use v3 (Drive) and v4 (Sheets).
//

import { getAccessToken } from './gauth.module.js';

const LOG_PREFIX = '[save.locator]';

function log(...args) {
  console.log(LOG_PREFIX, ...args);
}
function warn(...args) {
  console.warn(LOG_PREFIX, ...args);
}
function err(...args) {
  console.error(LOG_PREFIX, ...args);
}

async function authFetch(url, options = {}) {
  const token = await getAccessToken();
  const headers = new Headers(options.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  return fetch(url, { ...options, headers });
}

// ---- Drive helpers --------------------------------------------------------

async function driveGetFile(fileId, fields = 'id,name,parents,mimeType') {
  const res = await authFetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=${encodeURIComponent(fields)}`
  );
  if (!res.ok) throw new Error(`driveGetFile failed ${res.status}`);
  return res.json();
}

async function driveMoveFileToFolder(fileId, folderId) {
  // Add parent folder without removing existing (safe add). We also try to remove 'root' if present.
  const meta = await driveGetFile(fileId, 'id,parents');
  const currentParents = (meta.parents || []).join(',');
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}`);
  if (folderId) url.searchParams.set('addParents', folderId);
  if (currentParents) url.searchParams.set('removeParents', currentParents);
  const res = await authFetch(url.toString(), {
    method: 'PATCH',
    body: JSON.stringify({})
  });
  if (!res.ok) {
    // Some domains disallow changing parents; fail softly.
    warn('move to folder failed', await res.text());
  }
}

// ---- Sheets helpers -------------------------------------------------------

async function sheetsGet(spreadsheetId) {
  const res = await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`
  );
  if (!res.ok) throw new Error(`sheetsGet failed ${res.status}`);
  return res.json();
}

async function sheetsCreate(title) {
  const res = await authFetch(`https://sheets.googleapis.com/v4/spreadsheets`, {
    method: 'POST',
    body: JSON.stringify({
      properties: { title },
      sheets: [
        { properties: { title: 'Sheet1' } },
        { properties: { title: '__LM_MATERIALS' } }
      ]
    })
  });
  if (!res.ok) throw new Error(`sheetsCreate failed ${res.status}`);
  return res.json();
}

async function sheetsBatchUpdate(spreadsheetId, requests) {
  const res = await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
    { method: 'POST', body: JSON.stringify({ requests }) }
  );
  if (!res.ok) throw new Error(`sheetsBatchUpdate failed ${res.status}`);
  return res.json();
}

async function sheetsValuesUpdate(spreadsheetId, rangeA1, values) {
  const res = await authFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(rangeA1)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ range: rangeA1, values }) }
  );
  if (!res.ok) throw new Error(`sheetsValuesUpdate failed ${res.status}`);
  return res.json();
}

// ---- Core logic -----------------------------------------------------------

const MATERIALS_TITLE = '__LM_MATERIALS';

const MATERIALS_HEADER = [
  'materialKey',
  'opacity',
  'chromaColor',
  'chromaTolerance',
  'chromaFeather',
  'doubleSided',
  'unlitLike',
  'updatedAt',
  'updatedBy',
  'captionGid' // scope discriminator
];

function pickActiveCaptionSheet(sheets, prevCaptionGid) {
  // sheets: [{properties: {sheetId, title}}]
  if (!Array.isArray(sheets) || !sheets.length) return null;

  // 1) previous gid (if still present)
  if (prevCaptionGid != null) {
    const hit = sheets.find(s => s.properties?.sheetId === prevCaptionGid);
    if (hit && hit.properties?.title !== MATERIALS_TITLE) {
      return hit.properties.sheetId;
    }
  }

  // 2) named "Captions"
  const named = sheets.find(s => s.properties?.title === 'Captions');
  if (named) return named.properties.sheetId;

  // 3) first non-__LM_MATERIALS
  const first = sheets.find(s => s.properties?.title !== MATERIALS_TITLE);
  if (first) return first.properties.sheetId;

  return null;
}

async function ensureMaterialsSheet(spreadsheetId, spreadsheet) {
  // Find or create __LM_MATERIALS; also ensure header row
  const sheets = spreadsheet.sheets || [];
  let mat = sheets.find(s => s.properties?.title === MATERIALS_TITLE);
  let materialsGid;

  if (!mat) {
    log('create materials sheet');
    await sheetsBatchUpdate(spreadsheetId, [
      { addSheet: { properties: { title: MATERIALS_TITLE } } }
    ]);
    const fresh = await sheetsGet(spreadsheetId);
    mat = (fresh.sheets || []).find(s => s.properties?.title === MATERIALS_TITLE);
  }

  materialsGid = mat.properties.sheetId;

  // Ensure header in A1 row; we PUT raw header each time but only if row1 empty
  // Read a small range to check
  try {
    const res = await authFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(MATERIALS_TITLE + '!A1:Z1')}`
    );
    const ok = res.ok ? await res.json() : { values: [] };
    const hasAny = ok.values && ok.values[0] && ok.values[0].some(v => String(v).trim().length > 0);
    if (!hasAny) {
      log('materials header missing -> write');
      await sheetsValuesUpdate(spreadsheetId, MATERIALS_TITLE + '!A1:Z1', [MATERIALS_HEADER]);
    } else {
      log('materials header present -> SKIP');
    }
  } catch (e) {
    warn('materials header check failed; attempting to write', e);
    await sheetsValuesUpdate(spreadsheetId, MATERIALS_TITLE + '!A1:Z1', [MATERIALS_HEADER]);
  }

  return materialsGid;
}

async function begin({ glbId, glbName, previous }) {
  try {
    log('module loaded (ESM export active)');
    log('begin', { glbId, glbName });

    const file = await driveGetFile(glbId);
    const parentFolderId = (file.parents && file.parents[0]) || null;

    // Heuristic: Spreadsheet title tied to GLB name (stable)
    const title = (glbName && String(glbName).trim()) || file.name || 'LociMyu Save';

    // Strategy:
    // 1) Try to find an existing Sheet file in the same folder with matching title "<title>__LociMyu"
    // 2) Else create a new Spreadsheet with initial sheets and move it to the folder (if possible)

    const spreadsheetTitle = `${title}__LociMyu`;

    let spreadsheetId = null;
    // Search Drive (files.list) might require Drive scope beyond readonly; we'll soft-fallback if blocked.
    try {
      const q = [
        "mimeType='application/vnd.google-apps.spreadsheet'",
        `name='${spreadsheetTitle.replace(/'/g, "\\'")}'`,
      ];
      if (parentFolderId) {
        q.push(`'${parentFolderId}' in parents`);
      }
      const url = new URL('https://www.googleapis.com/drive/v3/files');
      url.searchParams.set('q', q.join(' and '));
      url.searchParams.set('fields', 'files(id,name,parents)');
      const listRes = await authFetch(url.toString());
      if (listRes.ok) {
        const listJson = await listRes.json();
        if (listJson.files && listJson.files[0]) {
          spreadsheetId = listJson.files[0].id;
        }
      }
    } catch (e) {
      warn('drive search skipped (insufficient scope or domain policy)', e);
    }

    let spreadsheet;
    if (!spreadsheetId) {
      log('create spreadsheet');
      const created = await sheetsCreate(spreadsheetTitle);
      spreadsheetId = created.spreadsheetId;
      spreadsheet = created;
      // Move to same folder as GLB if we know it
      if (parentFolderId) {
        await driveMoveFileToFolder(spreadsheetId, parentFolderId);
      }
    } else {
      spreadsheet = await sheetsGet(spreadsheetId);
    }

    const materialsGid = await ensureMaterialsSheet(spreadsheetId, spreadsheet);

    // Resolve active caption sheet (no auto-create)
    const prevCaptionGid = previous && previous.spreadsheetId === spreadsheetId
      ? previous.captionGid
      : null;

    const captionGid = pickActiveCaptionSheet(spreadsheet.sheets || [], prevCaptionGid);
    if (captionGid == null) {
      warn('No non-materials sheet found; using Sheet1 fallback (creating if absent)');
      // Ensure 'Sheet1' exists
      const hasSheet1 = (spreadsheet.sheets || []).find(s => s.properties?.title === 'Sheet1');
      if (!hasSheet1) {
        await sheetsBatchUpdate(spreadsheetId, [{ addSheet: { properties: { title: 'Sheet1' } } }]);
      }
      const fresh = await sheetsGet(spreadsheetId);
      const s1 = (fresh.sheets || []).find(s => s.properties?.title === 'Sheet1');
      if (!s1) throw new Error('failed to ensure Sheet1');
      const gid = s1.properties.sheetId;
      log('active caption sheet -> Sheet1', gid);
      const out = { spreadsheetId, materialsGid, captionGid: gid, defaultCaptionGid: gid };
      log('ready', out);
      return out;
    }

    const out = { spreadsheetId, materialsGid, captionGid, defaultCaptionGid: captionGid };
    log('ready', out);
    return out;
  } catch (e) {
    err('begin failed', e);
    throw e;
  }
}

export default {
  begin
};
