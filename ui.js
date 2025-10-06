
// ui.js — binds existing controls without changing UI structure
export function setupUI(app){
  const pick = (...sels)=>sels.map(s=>document.querySelector(s)).find(el=>el);

  // Load button
  const btnLoad = pick('#btnLoad', '#btn-glb', 'button[data-load]', 'button#load-glb');
  if (btnLoad) {
    btnLoad.addEventListener('click', async ()=>{
      try{
        await app.viewer.loadByInput();
      }catch(err){
        alert('[ui] failed to load ' + (err?.message||err));
        console.error(err);
      }
    });
  }

  // HSL/Opacity sliders (optional, binds if present)
  const hue = pick('#hue', 'input[name="hue"]');
  const sat = pick('#sat', 'input[name="sat"]');
  const lig = pick('#light', '#lig', 'input[name="light"]');
  const op  = pick('#opacity', 'input[name="opacity"]');
  const apply = ()=>{
    if (!app.viewer || !app.viewer.setHSLOpacity) return;
    const h = hue ? Number(hue.value)/360 : 0;
    const s = sat ? (Number(sat.value)-50)/100 : 0;
    const l = lig ? (Number(lig.value)-50)/100 : 0;
    const o = op  ? Number(op.value)/100 : 1;
    app.viewer.setHSLOpacity(h,s,l,o);
  };
  [hue,sat,lig,op].forEach(el=> el && el.addEventListener('input', apply));

  // Unlit / DoubleSide if the buttons exist
  const btnUnlit = pick('#btnUnlit','button[data-unlit]');
  btnUnlit && btnUnlit.addEventListener('click', ()=> app.viewer?.toggleUnlit?.(true));
  const btnDouble = pick('#btnDouble','button[data-doubleside]');
  btnDouble && btnDouble.addEventListener('click', ()=> app.viewer?.setDoubleSide?.(true));
}
