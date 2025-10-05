// Very small stub auth that toggles UI state and dispatches events.
export function setupAuth(){
  const chip = document.getElementById('signin-chip');
  const btn = document.getElementById('signin-btn');
  const label = document.getElementById('signin-label');
  let signedIn = false;
  function refresh(){ label.textContent = signedIn ? 'Signed in' : 'Signed out'; btn.textContent = signedIn ? 'Sign out' : 'Sign in'; }
  btn.onclick = ()=>{
    signedIn = !signedIn;
    refresh();
    const ev = new CustomEvent(signedIn ? 'auth:signed-in' : 'auth:signed-out', {detail:{stub:true}});
    window.dispatchEvent(ev);
  };
  refresh();
  console.log('[auth] ready');
}
