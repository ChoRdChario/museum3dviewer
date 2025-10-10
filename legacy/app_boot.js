// app_boot.js
// Wires up tabs, color pickers, and GLB load using Viewer API.

(function(){
  function $(q){ return document.querySelector(q); }
  function $all(q){ return Array.from(document.querySelectorAll(q)); }

  function initTabs(){
    const tabs = $all('.tab');
    const panels = $all('.panel-section');
    tabs.forEach(btn=>{
      btn.addEventListener('click', ()=>{
        tabs.forEach(b=>b.classList.remove('active'));
        btn.classList.add('active');
        const id = btn.dataset.tab;
        panels.forEach(p=>p.classList.toggle('active', p.dataset.panel===id));
      });
    });
  }

  function initColors(){
    const dots = $all('#pinColors .dot');
    dots.forEach(d=>{
      d.addEventListener('click', ()=>{
        dots.forEach(x=>x.classList.remove('active'));
        d.classList.add('active');
        const color = d.dataset.color;
        window.Viewer?.setPinColor(color);
      });
    });
    if(dots[0]) dots[0].click();
  }

  function initLoadGlb(){
    const input = $('#glbInput');
    const btn = $('#btnLoadGlb');
    btn.addEventListener('click', async ()=>{
      const v = input.value.trim();
      if(!v) return;
      try{
        await window.Viewer.ensureViewer();
        const url = convertToDirectUrl(v);
        await window.Viewer.loadGLB(url);
      }catch(err){
        console.error('[glb] load failed', err);
        alert('GLB load failed. See console for details.');
      }
    });
  }

  function convertToDirectUrl(s){
    // Accepts raw URL or Google Drive fileId/URL
    // https://drive.google.com/file/d/<id>/view?usp=sharing
    try{
      const u = new URL(s);
      if(u.hostname.includes('drive.google.com')){
        const m = u.pathname.match(/\/d\/([^/]+)/);
        const id = m? m[1] : u.searchParams.get('id');
        if(id) return `https://drive.google.com/uc?export=download&id=${id}`;
      }
      return s;
    }catch(_){
      // Not a URL => treat as Drive fileId
      return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(s)}`;
    }
  }

  function boot(){
    try{
      initTabs();
      initColors();
      initLoadGlb();
      window.Viewer.ensureViewer();
    }catch(err){
      console.error('[boot] failed', err);
    }
  }

  document.addEventListener('DOMContentLoaded', boot);
})();
