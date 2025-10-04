export function setupPins(app){
  const overlay = document.getElementById('overlay');
  document.getElementById('btnAddPin').addEventListener('click', ()=>{
    showOverlay({ title:'New Pin', body:'Click on the mesh to place.' });
  });
  document.getElementById('btnClearPins').addEventListener('click', ()=> hideOverlay());
  window.addEventListener('keydown', (e)=>{ if (e.key==='Escape') hideOverlay(); });

  function showOverlay({title, body, imgUrl}){
    overlay.style.display='block';
    overlay.innerHTML = `<strong>${title??''}</strong><div style="margin-top:.25rem">${body??''}</div>${imgUrl?`<img src="${imgUrl}">`:''}`;
  }
  function hideOverlay(){ overlay.style.display='none'; }
}
