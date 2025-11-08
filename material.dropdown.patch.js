
/* material.dropdown.patch.js v3.3f */
(function(){
  const TAG='[mat-dd v3.3f]';
  function origin(){ const o=window.__LM_MAT_ORIGIN; return (o&&o.locked)?o:null; }
  function uniqueByName(arr){ const seen=new Set(), out=[]; for(const it of arr){ const k=it.name||it.uuid; if(seen.has(k)) continue; seen.add(k); out.push(it);} return out;}
  function populate(select){
    const o=origin(); if(!o) return 0;
    const list=uniqueByName(o.items.slice().sort((a,b)=> (a.name||'').localeCompare(b.name||'')));
    while(select.firstChild) select.removeChild(select.firstChild);
    const ph=document.createElement('option'); ph.value=''; ph.textContent='— Select material —'; select.appendChild(ph);
    for(const {uuid,name} of list){ const opt=document.createElement('option'); opt.value=uuid; opt.textContent=name; select.appendChild(opt); }
    console.debug(TAG,'populated',list.length); return list.length;
  }
  function run(){ const sel=document.getElementById('mat-select'); if(!sel) return; const n=populate(sel); if(n===0){ window.addEventListener('lm:glb-detected',()=>setTimeout(()=>populate(sel),0),{once:true}); } }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',run,{once:true}); } else { run(); }
})();