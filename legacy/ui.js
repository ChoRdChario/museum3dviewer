// ui.js
export function setupUI({ onLoadGLB, onBg, onProj }){
  // Tabs
  const tabs = document.querySelectorAll('#tabs .tab');
  const panels = document.querySelectorAll('.panel');
  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('is-active'));
      panels.forEach(x=>x.classList.remove('is-active'));
      t.classList.add('is-active');
      document.querySelector(`#tab-${t.dataset.tab}`)?.classList.add('is-active');
    });
  });

  // GLB load
  const input = document.querySelector('#fileIdInput');
  const btnGLB = document.querySelector('#btnGLB');
  const doLoad = ()=>{
    const v = input.value.trim();
    if (!v) return;
    onLoadGLB?.(v);
  };
  input?.addEventListener('keydown', e=>{ if(e.key==='Enter') doLoad(); });
  btnGLB?.addEventListener('click', doLoad);

  // Background colors
  const bg = document.querySelector('#bgColors');
  if (bg){
    ['#0f1116','#1c1f2b','#000000','#2b2b2b','#224','#334','#223322'].forEach(hex=>{
      const b = document.createElement('button');
      b.className='color'; b.style.background=hex;
      b.addEventListener('click', ()=> onBg?.(hex));
      bg.appendChild(b);
    });
  }

  // Projection toggle
  const btnProj = document.querySelector('#btnProj');
  btnProj?.addEventListener('click', ()=>{
    const next = btnProj.textContent==='Perspective' ? 'Orthographic' : 'Perspective';
    btnProj.textContent = next;
    onProj?.(next);
  });
}
