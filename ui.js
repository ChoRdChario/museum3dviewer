export function setupUI(app){
  // tabs
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      tabs.forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tabpage').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });

  // background picker
  const inpBg = document.getElementById('inpBg');
  if(inpBg) inpBg.addEventListener('input', e=> app.viewer.setBackground(e.target.value));

  // demo
  const demo = document.getElementById('btnDemo');
  if(demo) demo.addEventListener('click', (e)=>{ e.preventDefault();
    // small public demo glb (threejs dam asset is large; keep cube demo)
    // keep visual feedback: reset cube rotation
    if(app.viewer.cube) app.viewer.cube.rotation.set(0,0,0);
  });

  // pin colors preset
  const palette = ['#f2d14b','#ff7d7d','#7de0ff','#7ee57b','#c7a0ff','#bfbfbf'];
  const pinWrap = document.getElementById('pinColors');
  palette.forEach(c=>{
    const d = document.createElement('div');
    d.className='dot'; d.style.background=c; d.title=c;
    d.addEventListener('click', ()=>{
      pinWrap.querySelectorAll('.dot').forEach(x=>x.classList.remove('active'));
      d.classList.add('active');
    });
    pinWrap.appendChild(d);
  });
  if(pinWrap.firstChild) pinWrap.firstChild.classList.add('active');

  // GLB load from input (allows raw URL)
  document.getElementById('btnLoad')?.addEventListener('click', async ()=>{
    const v = document.getElementById('inpGlb').value.trim();
    if(!v) return;
    try{
      await app.viewer.loadGLBFromURL(v);
      console.log('[viewer] GLB loaded (url mode)');
    }catch(e){ console.error(e); alert('Failed to load GLB: '+e); }
  });

  // material sliders (wire to demo cube if present)
  const h = document.getElementById('slHue');
  const s = document.getElementById('slSat');
  const l = document.getElementById('slLight');
  const o = document.getElementById('slOpacity');
  const btnUnlit = document.getElementById('btnUnlit');
  const btnDs = document.getElementById('btnDoubleSide');
  function targetMeshes(){
    if(app.viewer.model){
      const list=[]; app.viewer.model.traverse(o=>{ if(o.isMesh) list.push(o); });
      return list;
    }
    return app.viewer.cube ? [app.viewer.cube] : [];
  }
  function applyMat(){
    const hue = parseFloat(h.value||0), sat=parseFloat(s.value||0), li=parseFloat(l.value||0.5), op=parseFloat(o.value||1);
    targetMeshes().forEach(mesh=>{
      mesh.material.transparent = op<1 || mesh.material.transparent;
      mesh.material.opacity = op;
      mesh.material.needsUpdate = true;
    });
  }
  [h,s,l,o].forEach(el=> el.addEventListener('input', applyMat));
  btnUnlit?.addEventListener('click', ()=>{
    const on = btnUnlit.textContent.includes('off');
    btnUnlit.textContent = 'Unlit: ' + (on?'on':'off');
    targetMeshes().forEach(m=>{
      const mat = m.material;
      mat.onBeforeCompile = (shader)=>{ /* idempotent stub */ };
      mat.needsUpdate = true;
    });
  });
  btnDs?.addEventListener('click', ()=>{
    const on = btnDs.textContent.includes('off');
    btnDs.textContent = 'DoubleSide: ' + (on?'on':'off');
    targetMeshes().forEach(m=>{ m.material.side = on? 2: 0; m.material.needsUpdate=true; });
  });
}
