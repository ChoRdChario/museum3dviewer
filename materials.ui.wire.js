
// materials.ui.wire.js
// Wires material select & opacity slider to Google Sheets (__LM_MATERIALS).
// Requires window.__lm_fetchJSONAuth (v2 shim) and materials.sheet.persist.js to be loaded.

const SHEET_ID  = (window.__LM_SHEET_CTX?.spreadsheetId) || '19tNgby-h-2BeSRuDArQaJTm5EKpmh2Myzi5ONPyZAT8';
const MAT_SHEET = '__LM_MATERIALS';

async function ensureHeaders() {
  const headers = [
    'materialKey','opacity','doubleSided','unlitLike',
    'chromaEnable','chromaColor','chromaTolerance','chromaFeather',
    'roughness','metalness','emissiveHex',
    'updatedAt','updatedBy'
  ];
  await __lm_fetchJSONAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MAT_SHEET+'!A1:M1')}?valueInputOption=RAW`,
    { method: 'PUT', body: { values: [headers] } }
  );
}

async function upsertMaterialRow(payload) {
  const {
    materialKey, opacity, doubleSided=false, unlitLike=false,
    chromaEnable=false, chromaColor='#000000', chromaTolerance=0, chromaFeather=0,
    roughness='', metalness='', emissiveHex='', updatedBy='mat-ui'
  } = payload;

  const colA = await __lm_fetchJSONAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(MAT_SHEET+'!A:A')}`
  );
  const rows = colA.values || [];
  let rowIndex = rows.findIndex(r => (r[0]||'') === materialKey);
  let rowNumber;
  if (rowIndex <= 0) {
    rowNumber = rows.length + 1;
    await __lm_fetchJSONAuth(
      `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(`${MAT_SHEET}!A${rowNumber}:A${rowNumber}`)}?valueInputOption=RAW`,
      { method:'PUT', body:{ values:[[materialKey]] } }
    );
  } else {
    rowNumber = rowIndex + 1;
  }

  const iso = new Date().toISOString();
  const rowValues = [
    opacity ?? '',
    (doubleSided ? 'TRUE' : 'FALSE'),
    (unlitLike ? 'TRUE' : 'FALSE'),
    (chromaEnable ? 'TRUE' : 'FALSE'),
    chromaColor || '',
    String(chromaTolerance ?? ''),
    String(chromaFeather ?? ''),
    String(roughness ?? ''),
    String(metalness ?? ''),
    emissiveHex || '',
    iso,
    updatedBy
  ];
  const rangeBM = `${MAT_SHEET}!B${rowNumber}:M${rowNumber}`;
  await __lm_fetchJSONAuth(
    `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${encodeURIComponent(rangeBM)}?valueInputOption=RAW`,
    { method:'PUT', body:{ values:[rowValues] } }
  );
  console.log('[persist] wrote', { rowNumber, materialKey, rowValues });
}

// Install wire once UI is present
(function installWireOnce() {
  let installed = false;

  async function tryInstall() {
    if (installed) return;
    const sel = document.querySelector('#pm-material') || document.querySelector('#materialSelect');
    const rng = document.querySelector('#pm-opacity-range') || document.querySelector('#opacityRange');
    if (!sel || !rng) return;

    if (typeof window.__lm_fetchJSONAuth !== 'function') {
      console.warn('[wire] __lm_fetchJSONAuth missing; postpone');
      return;
    }

    installed = true;
    try { await ensureHeaders(); } catch (e) { console.warn('[wire] ensureHeaders warn', e); }

    const lastSent = new Map();
    const send = async () => {
      const materialKey = sel.value || sel.selectedOptions?.[0]?.value || '';
      if (!materialKey) return;
      const payload = {
        materialKey,
        opacity: parseFloat(rng.value),
        doubleSided:false, unlitLike:false,
        chromaEnable:false, chromaColor:'#000000',
        chromaTolerance:0, chromaFeather:0,
        roughness:'', metalness:'', emissiveHex:'',
        updatedBy:'mat-ui'
      };
      const sig = JSON.stringify(payload);
      if (lastSent.get(materialKey) === sig) return;
      lastSent.set(materialKey, sig);
      await upsertMaterialRow(payload);
    };

    let t; const debounced = () => { clearTimeout(t); t = setTimeout(send, 150); };
    rng.addEventListener('input', debounced,  { passive:true });
    rng.addEventListener('change', debounced, { passive:true });
    rng.addEventListener('pointerup', debounced, { passive:true });
    sel.addEventListener('change', send, { passive:true });

    console.log('[bind] materials persist attached');
  }

  const iv = setInterval(tryInstall, 300);
  window.addEventListener('load', tryInstall, { once:true });
  window.addEventListener('lm:mat-ui-ready', tryInstall);
})();
