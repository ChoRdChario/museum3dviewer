
// save.locator.js
// LociMyu: find or create a save spreadsheet next to the GLB on Drive
// - Tolerant to missing glbId: will fall back to window.__LM_CURRENT_GLB_ID
// - Guarantees __LM_MATERIALS sheet and header
// - Does NOT auto-create caption sheet unless none exists at all
//
// Exports:
//   findOrCreateSaveSheetByGlbId({ glbId, glbName }):
//     -> { spreadsheetId, materialsGid, captionGid, defaultCaptionGid }
//
const LOG_PREFIX = '[save.locator]';
const MATERIALS_SHEET_TITLE = '__LM_MATERIALS';
const MATERIALS_HEADER = [
  'materialKey','opacity','chromaColor','chromaTolerance','chromaFeather',
  'doubleSided','unlitLike','updatedAt','updatedBy'
];

// ---- hook for setCurrentGlbId so we can capture GLB id globally ----
(function hookSetCurrentGlbId() {
  const wrap = () => {
    const prev = window.setCurrentGlbId;
    if (typeof prev === 'function' && !prev.__lmWrapped) {
      window.setCurrentGlbId = function(id, ...rest) {
        window.__LM_CURRENT_GLB_ID = id;
        try { return prev.apply(this, [id, ...rest]); }
        finally { /* no-op */ }
      };
      window.setCurrentGlbId.__lmWrapped = true;
      console.log(LOG_PREFIX, 'hooked setCurrentGlbId');
    }
  };
  // try immediately and then poll a few times
  wrap();
  let tries = 0;
  const timer = setInterval(() => {
    if (window.setCurrentGlbId && window.setCurrentGlbId.__lmWrapped) {
      clearInterval(timer);
    } else if (tries++ > 40) { // ~4s
      clearInterval(timer);
    } else {
      wrap();
    }
  }, 100);
})();

async function getAccessToken() {
  // defer import to avoid cyclic timing issues
  const gauth = await import('./gauth.module.js');
  const tok = await gauth.getAccessToken();
  if (!tok) throw new Error('No OAuth token');
  return tok;
}

async function authFetchJSON(url, init={}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers||{})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status} @ ${url} :: ${body}`);
  }
  return res.json();
}

async function authFetch(url, init={}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      'Authorization': `Bearer ${token}`,
      ...(init.headers||{})
    }
  });
  if (!res.ok) {
    const body = await res.text().catch(()=>'');
    throw new Error(`HTTP ${res.status} @ ${url} :: ${body}`);
  }
  return res;
}

async function getGlbMeta(glbId) {
  const fields = encodeURIComponent('id,name,parents');
  return authFetchJSON(`https://www.googleapis.com/drive/v3/files/${glbId}?fields=${fields}`);
}

async function listSpreadsheetsInParent(parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`);
  const fields = encodeURIComponent('files(id,name),nextPageToken');
  const out = [];
  let pageToken = '';
  do {
    const data = await authFetchJSON(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}${pageToken ? '&pageToken='+pageToken : ''}`);
    out.push(...(data.files||[]));
    pageToken = data.nextPageToken || '';
  } while(pageToken);
  return out;
}

async function moveFileToParent(fileId, parentId, previousParents) {
  // previousParents must be a comma separated list of ids to remove
  return authFetchJSON(`https://www.googleapis.com/drive/v3/files/${fileId}?addParents=${parentId}&removeParents=${encodeURIComponent(previousParents)}`, {
    method: 'PATCH'
  });
}

async function ensureMaterialsHeader(spreadsheetId, sheetId) {
  // read first row, set if missing/mismatched
  const get = await authFetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
  const sheet = (get.sheets||[]).find(s => s.properties && s.properties.sheetId === sheetId);
  if (!sheet) throw new Error('materials sheet not found by gid');
  const grid = sheet.data?.[0] || null;
  // simpler: just set A1: header unconditionally with values.update
  await authFetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(MATERIALS_SHEET_TITLE+'!A1:I1')}?valueInputOption=RAW`, {
    method: 'PUT',
    body: JSON.stringify({ values: [MATERIALS_HEADER] })
  });
}

async function createSpreadsheetWithMaterials(title) {
  const payload = {
    properties: { title },
    sheets: [{
      properties: { title: MATERIALS_SHEET_TITLE },
      data: [{
        rowData: [{
          values: MATERIALS_HEADER.map(h => ({ userEnteredValue: { stringValue: h } }))
        }]
      }]
    }]
  };
  const created = await authFetchJSON('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
  // find gids
  const sheets = created.sheets || [];
  const materials = sheets.find(s => s.properties.title === MATERIALS_SHEET_TITLE);
  return {
    spreadsheetId: created.spreadsheetId,
    materialsGid: materials?.properties?.sheetId || 0
  };
}

async function getSpreadsheet(spreadsheetId) {
  return authFetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`);
}

function chooseCaptionSheet(sheets) {
  // Prefer "Captions"; else first non-materials; else null
  const byTitle = new Map(sheets.map(s => [s.properties.title, s]));
  if (byTitle.has('Captions')) return byTitle.get('Captions').properties.sheetId;
  const nonMaterials = sheets.find(s => s.properties.title !== MATERIALS_SHEET_TITLE);
  return nonMaterials ? nonMaterials.properties.sheetId : null;
}

async function addSheet(spreadsheetId, title) {
  const body = {
    requests: [{
      addSheet: {
        properties: { title }
      }
    }]
  };
  const resp = await authFetchJSON(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify(body)
  });
  const sheet = resp.replies?.[0]?.addSheet?.properties;
  return sheet?.sheetId || null;
}

export async function findOrCreateSaveSheetByGlbId(opts = {}) {
  console.log(LOG_PREFIX, 'module loaded (ESM export active)');
  let { glbId, glbName } = opts || {};
  if (!glbId) {
    glbId = window.__LM_CURRENT_GLB_ID || null;
  }
  console.log(LOG_PREFIX, 'begin', { glbId, glbName });
  if (!glbId) {
    throw new Error('glbId is required (no argument and no captured __LM_CURRENT_GLB_ID)');
  }

  // 1) read GLB meta
  const glb = await getGlbMeta(glbId);
  const parent = (glb.parents && glb.parents[0]) || null;
  const name = glbName || glb.name || 'LociMyu Target';
  if (!parent) {
    throw new Error('GLB has no parent folder');
  }

  // 2) find existing spreadsheet in same parent
  const candidates = await listSpreadsheetsInParent(parent);
  // naming heuristic: prefer a spreadsheet whose name includes the GLB name or "LociMyu"
  const preferred = candidates.find(f => f.name && (f.name.includes(name) || /LociMyu/i.test(f.name))) || candidates[0];

  let spreadsheetId;
  let materialsGid;
  if (preferred) {
    spreadsheetId = preferred.id;
    // ensure materials sheet exists + header
    const ss = await getSpreadsheet(spreadsheetId);
    const sheets = ss.sheets || [];
    let materials = sheets.find(s => s.properties.title === MATERIALS_SHEET_TITLE);
    if (!materials) {
      // add materials sheet
      const newGid = await addSheet(spreadsheetId, MATERIALS_SHEET_TITLE);
      materialsGid = newGid;
    } else {
      materialsGid = materials.properties.sheetId;
    }
    await ensureMaterialsHeader(spreadsheetId, materialsGid);
    console.log(LOG_PREFIX, 'spreadsheet located', { spreadsheetId });
  } else {
    // 3) create new spreadsheet and move into folder
    const createdTitle = `${name} — LociMyu Save`;
    const created = await createSpreadsheetWithMaterials(createdTitle);
    spreadsheetId = created.spreadsheetId;
    materialsGid = created.materialsGid;
    // move to same folder
    // we need previous parents list to remove; fetch them via Drive get again to be safe
    const me = await authFetchJSON(`https://www.googleapis.com/drive/v3/files/${spreadsheetId}?fields=parents`);
    const prevParents = (me.parents || []).join(',');
    if (!prevParents.includes(parent)) {
      await moveFileToParent(spreadsheetId, parent, prevParents);
    }
    console.log(LOG_PREFIX, 'spreadsheet created', { spreadsheetId });
  }

  // 4) choose caption sheet (no auto-create unless none exists at all)
  const ss2 = await getSpreadsheet(spreadsheetId);
  const sheets2 = ss2.sheets || [];
  let captionGid = chooseCaptionSheet(sheets2);
  if (captionGid == null) {
    // as a fallback only (extremely rare), create Sheet1
    captionGid = await addSheet(spreadsheetId, 'Sheet1');
  }

  // final
  const result = { spreadsheetId, materialsGid, captionGid, defaultCaptionGid: captionGid };
  console.log(LOG_PREFIX, 'done', result);
  return result;
}

export default { findOrCreateSaveSheetByGlbId };
