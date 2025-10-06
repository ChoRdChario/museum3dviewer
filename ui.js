export function setupUI(app){
  const q = (sel)=> document.querySelector(sel);
  const on = (el, evt, fn, sel) => {
    if (!el) { console.warn('[ui] missing', sel); return; }
    el.addEventListener(evt, fn);
  };

  const elUrl   = q('#url-input');
  const elFile  = q('#file-input');
  const elLoad  = q('#load-btn');
  const elUnlit = q('#unlit-btn');
  const elHue   = q('#hue');
  const elSat   = q('#sat');
  const elLig   = q('#light');
  const elOpac  = q('#opacity');

  on(elLoad, 'click', async ()=>{
    await app?.viewer?.loadByInput?.({ urlInput: elUrl, fileInput: elFile });
  }, '#load-btn');

  const applyMat = ()=>{
    app?.viewer?.setHSLOpacity?.({
      h: Number(elHue?.value ?? 0),
      s: Number(elSat?.value ?? 0),
      l: Number(elLig?.value ?? 0),
      opacity: Number(elOpac?.value ?? 1),
    });
  };
  on(elHue,  'input', applyMat, '#hue');
  on(elSat,  'input', applyMat, '#sat');
  on(elLig,  'input', applyMat, '#light');
  on(elOpac, 'input', applyMat, '#opacity');

  on(elUnlit, 'click', ()=> app?.viewer?.toggleUnlit?.(), '#unlit-btn');
}
