(function(){
  if (window.__LM_CAPTION_SHEET_BRIDGE_V2__) {
    console.log('[caption.sheet.bridge] v2 already loaded');
    return;
  }
  window.__LM_CAPTION_SHEET_BRIDGE_V2__ = true;

  const HEADER = [
    'id',
    'title',
    'body',
    'color',
    'posX',
    'posY',
    'posZ',
    'imageFileId',
    'createdAt',
    'updatedAt',
  ];

  const STATE = {
    spreadsheetId: null,
    sheetGid: null,
    sheetTitle: null,
    headerRangeA1: null,
    nextRowIndex: 2,
    initializedForSheet: false,
  };

  function log(...args){
    console.log('[caption.sheet.bridge]', ...args);
  }
  function warn(...args){
    console.warn('[caption.sheet.bridge]', ...args);
  }
  function err(...args){
    console.error('[caption.sheet.bridge]', ...args);
  }

  function makeHeaderRange(sheetTitle){
    return `${sheetTitle}!A1:J1`;
  }

  function rowToItem(row, colIdx){
    const get = (name) => {
      const idx = colIdx[name];
      return (idx != null && row[idx] != null) ? row[idx] : '';
    };

    const id = get('id') || ('c_'+Math.random().toString(36).slice(2,10));
    const title = get('title') || '';
    const body = get('body') || '';
    const color = get('color') || '#eab308';

    const posXRaw = get('posX');
    const posYRaw = get('posY');
    const posZRaw = get('posZ');
    const posX = posXRaw === '' ? null : Number(posXRaw);
    const posY = posYRaw === '' ? null : Number(posYRaw);
    const posZ = posZRaw === '' ? null : Number(posZRaw);

    let pos = null;
    if (posX != null && !Number.isNaN(posX) &&
        posY != null && !Number.isNaN(posY) &&
        posZ != null && !Number.isNaN(posZ)){
      pos = { x: posX, y: posY, z: posZ };
    }

    const imageFileId = get('imageFileId') || '';
    const createdAt = get('createdAt') || null;
    const updatedAt = get('updatedAt') || null;

    return {
      id,
      title,
      body,
      color,
      pos,
      imageFileId,
      createdAt,
      updatedAt,
    };
  }

  function buildColIndex(headerRow){
    const idx = {};
    headerRow.forEach((name, i) => {
      idx[name] = i;
    });
    return idx;
  }

  function itemToRow(item, mode){
    const now = new Date().toISOString();
    const pos = item.pos || {};
    // NOTE:
    //  - Viewer / caption UI sometimes stores pos.x/y/z as string values.
    //  - The previous version only accepted typeof === 'number', which caused
    //    all coordinates to be treated as empty and posX/posY/posZ were not
    //    written to the sheet.
    //  - We now accept both numbers and numeric strings and write them as-is.
    const px = (pos.x !== undefined && pos.x !== null) ? pos.x : '';
    const py = (pos.y !== undefined && pos.y !== null) ? pos.y : '';
    const pz = (pos.z !== undefined && pos.z !== null) ? pos.z : '';
    const id = item.id || ('c_'+Math.random().toString(36).slice(2,10));
    let createdAt = item.createdAt;
    if (!createdAt || mode === 'append'){
      createdAt = createdAt || now;
    }
    const updatedAt = now;
    return {
      row: [
        id,
        item.title||'',
        item.body||'',
        item.color||'#eab308',
        px, py, pz,
        (item.image && item.image.id) || item.imageFileId || '',
        createdAt,
        updatedAt
      ],
      id,
      createdAt,
      updatedAt,
    };
  }

  function assertSheetsApi(){
    if (!window.__lmSheetsValuesGet || !window.__lmSheetsValuesUpdate || !window.__lmSheetsValuesAppend){
      throw new Error('Sheets bridge (__lmSheetsValues*) is not available');
    }
  }

  async function ensureHeader(){
    assertSheetsApi();
    const { spreadsheetId, sheetTitle } = STATE;
    if (!spreadsheetId || !sheetTitle){
      throw new Error('ensureHeader called without sheet context');
    }
    const range = makeHeaderRange(sheetTitle);
    STATE.headerRangeA1 = range;
    try {
      await window.__lmSheetsValuesUpdate(spreadsheetId, range, [HEADER]);
      log('header put', range);
    } catch (e){
      err('failed to put header', range, e);
      throw e;
    }
  }

  async function loadAllRows(){
    assertSheetsApi();
    const { spreadsheetId, sheetTitle } = STATE;
    if (!spreadsheetId || !sheetTitle){
      throw new Error('loadAllRows called without sheet context');
    }
    const range = `${sheetTitle}!A2:J`;
    try {
      const res = await window.__lmSheetsValuesGet(spreadsheetId, range);
      const values = (res && res.values) || [];
      if (!values.length){
        STATE.nextRowIndex = 2;
        log('no caption rows');
        return [];
      }
      const headerRes = await window.__lmSheetsValuesGet(spreadsheetId, makeHeaderRange(sheetTitle));
      const headerRow = (headerRes && headerRes.values && headerRes.values[0]) || HEADER;
      const colIdx = buildColIndex(headerRow);
      const items = values.map(row => rowToItem(row, colIdx));
      STATE.nextRowIndex = 2 + values.length;
      log('loaded rows', {count: values.length, nextRowIndex: STATE.nextRowIndex});
      return items;
    } catch (e){
      err('failed to load rows', e);
      return [];
    }
  }

  function waitCaptionUI(){
    return new Promise((resolve) => {
      if (window.__LM_CAPTION_UI){
        return resolve(window.__LM_CAPTION_UI);
      }
      const maxTries = 50;
      let tries = 0;
      const timer = setInterval(() => {
        tries++;
        if (window.__LM_CAPTION_UI){
          clearInterval(timer);
          resolve(window.__LM_CAPTION_UI);
          return;
        }
        if (tries >= maxTries){
          clearInterval(timer);
          warn('caption UI not ready (wait timeout)');
          resolve(null);
        }
      }, 200);
    });
  }

  async function syncFromSheet(){
    const ui = await waitCaptionUI();
    if (!ui){
      warn('syncFromSheet aborted: no caption UI');
      return;
    }
    const items = await loadAllRows();
    ui.replaceAll(items);
  }

  async function appendItemToSheet(item){
    assertSheetsApi();
    const { spreadsheetId, sheetTitle } = STATE;
    if (!spreadsheetId || !sheetTitle){
      throw new Error('appendItemToSheet called without sheet context');
    }
    const { row } = itemToRow(item, 'append');
    const range = `${sheetTitle}!A${STATE.nextRowIndex}:J${STATE.nextRowIndex}`;
    try {
      await window.__lmSheetsValuesUpdate(spreadsheetId, range, [row]);
      log('append row', row[0], 'row', STATE.nextRowIndex);
      STATE.nextRowIndex += 1;
    } catch (e){
      err('append row failed', e);
    }
  }

  async function updateItemInSheet(item){
    assertSheetsApi();
    const { spreadsheetId, sheetTitle } = STATE;
    if (!spreadsheetId || !sheetTitle){
      throw new Error('updateItemInSheet called without sheet context');
    }
    const ui = window.__LM_CAPTION_UI;
    if (!ui || !ui.indexOfId){
      warn('updateItemInSheet: ui.indexOfId not available');
      return;
    }
    const index = ui.indexOfId(item.id);
    if (index < 0){
      warn('updateItemInSheet: id not found in ui store', item.id);
      return;
    }
    const rowIndex = 2 + index;
    const { row } = itemToRow(item, 'update');
    const range = `${sheetTitle}!A${rowIndex}:J${rowIndex}`;
    try {
      await window.__lmSheetsValuesUpdate(spreadsheetId, range, [row]);
      log('update row', item.id, 'row', rowIndex);
    } catch (e){
      err('update row failed', e);
    }
  }

  async function onSheetContext(ev){
    const ctx = ev && ev.detail;
    if (!ctx){
      warn('sheet-context event without detail');
      return;
    }
    STATE.spreadsheetId = ctx.spreadsheetId;
    STATE.sheetGid = ctx.sheetGid;
    STATE.sheetTitle = ctx.sheetTitle || 'シート1';
    STATE.nextRowIndex = (ctx.nextRowIndex && Number(ctx.nextRowIndex)) || 2;
    STATE.initializedForSheet = true;

    log('sheet-context', ctx);

    try {
      await ensureHeader();
      await syncFromSheet();
    } catch (e){
      err('failed during sheet-context handling', e);
    }

    const ui = await waitCaptionUI();
    if (!ui){
      warn('sheet-context: no caption UI for wiring events');
      return;
    }

    if (!ui.__lmSheetWired){
      ui.__lmSheetWired = true;
      if (ui.onItemAdded){
        ui.onItemAdded(async (item) => {
          await appendItemToSheet(item);
        });
      }
      if (ui.onItemChanged){
        ui.onItemChanged(async (item) => {
          await updateItemInSheet(item);
        });
      }
      log('caption UI events wired');
    }
  }

  window.addEventListener('lm:sheet-context', onSheetContext);

  log('armed');
})();