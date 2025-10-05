export function setupAuth(){
  const btn = document.getElementById('btnSign');
  if(!btn) return;
  let signed = false;
  const refresh = ()=>{ btn.textContent = signed ? 'Signed in' : 'Sign in'; btn.classList.toggle('on', signed); };
  refresh();
  btn.addEventListener('click', ()=>{
    // Stub: toggle state to give UI feedback
    signed = !signed;
    refresh();
  });
}
