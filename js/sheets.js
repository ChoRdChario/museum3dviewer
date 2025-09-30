export class Sheets {
  constructor(){}
  async ensureSaveSheets(ssId, slotName){
    // Two sheets: <slot>_Pins and <slot>_Materials
    const want = [`${slotName}_Pins`, `${slotName}_Materials`];
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: ssId });
    const titles = new Set((meta.result.sheets||[]).map(s=>s.properties.title));
    const requests = [];
    for(const t of want){
      if(!titles.has(t)){
        requests.push({ addSheet: { properties: { title: t } } });
      }
    }
    if(requests.length){
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: ssId,
        resource: { requests }
      });
    }
  }

  async listSlots(ssId){
    const meta = await gapi.client.sheets.spreadsheets.get({ spreadsheetId: ssId });
    const slots = new Set();
    for(const s of (meta.result.sheets||[])){
      const t = s.properties.title;
      const m = t.match(/^(.*)_(Pins|Materials)$/);
      if(m) slots.add(m[1]);
    }
    return Array.from(slots);
  }

  async writePins(ssId, slotName, rows){
    // rows: [id,x,y,z,color,title,body,imageId,imageName]
    const range = `${slotName}_Pins!A2:I`;
    // Clear & write
    await gapi.client.sheets.spreadsheets.values.clear({ spreadsheetId: ssId, range });
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: ssId, range,
      valueInputOption: 'RAW',
      resource: { values: rows }
    });
    // header if missing
    const headerRange = `${slotName}_Pins!A1:I1`;
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: ssId, range: headerRange,
      valueInputOption: 'RAW',
      resource: { values: [[
        'id','x','y','z','color','title','body','imageId','imageName'
      ]]}
    });
  }

  async readPins(ssId, slotName){
    const range = `${slotName}_Pins!A2:I`;
    const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: ssId, range });
    const values = res.result.values || [];
    return values.map(r=> ({
      id: r[0], x:+r[1], y:+r[2], z:+r[3],
      color: r[4]||'red', title: r[5]||'', body: r[6]||'',
      imageId: r[7]||'', imageName: r[8]||''
    }));
  }

  async writeMaterials(ssId, slotName, mat){
    const range = `${slotName}_Materials!A1:B10`;
    const rows = Object.entries(mat);
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: ssId, range, valueInputOption:'RAW',
      resource: { values: rows }
    });
  }

  async readMaterials(ssId, slotName){
    const range = `${slotName}_Materials!A1:B10`;
    const res = await gapi.client.sheets.spreadsheets.values.get({ spreadsheetId: ssId, range });
    const out = {};
    for(const r of (res.result.values||[])){
      out[r[0]] = r[1];
    }
    return out;
  }
}
