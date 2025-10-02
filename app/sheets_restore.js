
const SHEET_NAME='pins';
export async function loadPinsFromSheet(spreadsheetId){
  try{
    const res=await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId, range:`${SHEET_NAME}!A2:K`
    });
    const rows=(res.result.values||[]);
    return rows.map(r=>({
      id:r[0]||'',
      x:parseFloat(r[1]||'0'), y:parseFloat(r[2]||'0'), z:parseFloat(r[3]||'0'),
      title:r[4]||'', body:r[5]||'',
      imageUrl:r[6]||'', imageId:r[7]||'', thumbnailLink:r[8]||'',
      createdAt:r[9]||'', updatedAt:r[10]||''
    }));
  }catch(e){
    console.warn('[sheets] loadPinsFromSheet failed or empty', e);
    return [];
  }
}