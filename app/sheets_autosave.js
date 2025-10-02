const SHEET_NAME='pins';
const HEADER=['id','x','y','z','title','body','imageUrl','imageId','thumbnailLink','createdAt','updatedAt'];

async function ensureHeader(ssId,sheetName,header){
  try{
    await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId:ssId, range:`${sheetName}!A1:Z1` });
  }catch(e){
    await gapi.client.sheets.spreadsheets.batchUpdate({ spreadsheetId:ssId, resource:{ requests:[{ addSheet:{ properties:{ title:sheetName } } }] } });
  }
  await gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId:ssId,
    range:`${sheetName}!A1:${String.fromCharCode(64+header.length)}1`,
    valueInputOption:'RAW',
    resource:{ values:[header] }
  });
}

export function createAutosave({ bus, store, findOrCreateSpreadsheetInSameFolder, glbFileId }){
  let spreadsheetId=null; let timer=null; const DEBOUNCE_MS=800;
  async function ensureSheet(){ spreadsheetId=await findOrCreateSpreadsheetInSameFolder(glbFileId); await ensureHeader(spreadsheetId,SHEET_NAME,HEADER); }
  async function flush(){
    if(!window.gapi?.client) return;
    if(!spreadsheetId) await ensureSheet();
    const pins=store.state.pins||[];
    const rows=pins.map(p=>[
      p.id, p.x, p.y, p.z,
      p.caption?.title||'',
      p.caption?.body||'',
      p.caption?.img||'',
      p.caption?.imageId||'',
      p.caption?.thumbnailLink||'',
      p.createdAt||new Date().toISOString(),
      new Date().toISOString()
    ]);
    await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId, range:`${SHEET_NAME}!A2:Z` });
    if(rows.length){
      await gapi.client.sheets.spreadsheets.values.append({
        spreadsheetId, range:`${SHEET_NAME}!A2`,
        valueInputOption:'RAW', insertDataOption:'OVERWRITE',
        resource:{ values:rows }
      });
    }
  }
  function schedule(){ clearTimeout(timer); timer=setTimeout(flush,DEBOUNCE_MS); }
  bus.on('pin:added',schedule);
  bus.on('pin:selected',schedule);
  bus.on('overlay:show',schedule);
  return { flush };
}