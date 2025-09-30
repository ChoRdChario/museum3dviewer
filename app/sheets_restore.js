
const SHEET_NAME = 'pins';

export async function loadPinsFromSheet(spreadsheetId){
  // Returns array of {id,x,y,z,title,body,imageUrl,createdAt,updatedAt}
  try{
    const res = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId, range: `${SHEET_NAME}!A2:I`
    });
    const rows = (res.result.values||[]);
    return rows.map(r=>({
      id: r[0]||'', x: parseFloat(r[1]||'0'), y: parseFloat(r[2]||'0'), z: parseFloat(r[3]||'0'),
      title: r[4]||'', body: r[5]||'', imageUrl: r[6]||'', createdAt: r[7]||'', updatedAt: r[8]||''
    }));
  }catch(e){
    // Sheet may not exist yet or be empty; treat as empty
    console.warn('[sheets] loadPinsFromSheet failed or empty', e);
    return [];
  }
}
