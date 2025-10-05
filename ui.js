// wire UI to viewer
export function setupUI(app){
  const $ = (sel)=>document.querySelector(sel);
  const on = (el, ev, fn)=>el&&el.addEventListener(ev, fn);

  // Tabs
  document.querySelectorAll('#tabs .tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('active'));
      document.querySelectorAll('.pane').forEach(p=>p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('pane-'+tab.dataset.tab).classList.add('active');
    });
  });

  // Load demo
  on($('#demoLink'), 'click', async (e)=>{ e.preventDefault(); await app.viewer.loadDemo(); });

  // Load from input
  on($('#loadGlbBtn'), 'click', async ()=>{
    const v = $('#fileIdInput').value.trim();
    if(!v){ alert('Enter Drive ID or URL'); return; }
    try{
      await app.viewer.loadByInput(v);
    }catch(err){
      console.error(err);
      alert('GLBの読み込みに失敗しました（CORSの可能性があります）\n' + err.message);
    }
  });

  // Material panel
  const matSel = $('#matTarget');
  const hue = $('#matHue'), sat=$('#matSat'), lig=$('#matLight'), op=$('#matOpacity'), white=$('#matWhite');
  const unlitBtn = $('#matUnlit'), dsBtn=$('#matDoubleSide');
  function applyMat(){
    const idx = parseInt(matSel.value,10);
    app.viewer.setHSLOpacity({target:idx, h:parseFloat(hue.value||0), s:parseFloat(sat.value||1), l:parseFloat(lig.value||1), opacity:parseFloat(op.value||1)});
  }
  [hue,sat,lig,op].forEach(inp=>on(inp,'input',applyMat));
  on(unlitBtn,'click',()=>{
    const idx = parseInt(matSel.value,10);
    app.viewer.toggleUnlit(idx);
    unlitBtn.textContent = 'Unlit: toggled';
    setTimeout(()=>unlitBtn.textContent='Unlit',600);
  });
  on(dsBtn,'click',()=>{
    const idx = parseInt(matSel.value,10);
    const onNow = dsBtn.dataset.on==='1';
    app.viewer.setDoubleSide(idx, !onNow);
    dsBtn.dataset.on = onNow?'0':'1';
    dsBtn.textContent = 'DoubleSide: ' + (onNow?'off':'on');
  });
  on(white,'input',()=>{
    const idx = parseInt(matSel.value,10);
    app.viewer.setWhiteKey(idx, parseFloat(white.value||1));
  });

  // Populate materials when model loaded
  app.events.addEventListener('viewer:materials', (e)=>{
    const list = e.detail.list || [];
    matSel.innerHTML = '<option value="-1">(All)</option>' + list.map((t,i)=>`<option value="${i}">${i}: ${t.name}</option>`).join('');
  });

  // Caption dummy pin (UI only – the full pins system is separate)
  on($('#addPin'),'click',()=>{
    const ov = document.getElementById('overlay');
    ov.style.display = 'block';
    document.getElementById('ov-title').textContent = ($('#capTitle').value||'(untitled)');
    document.getElementById('ov-body').textContent = ($('#capBody').value||'');
  });
}
