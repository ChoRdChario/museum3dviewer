// gauth.js — hardened sign-in chip; safe on missing elements
// Exports: setupAuth(app)
// Expected DOM (optional):
//   #chipSign  : small status chip (text shows "Sign in"/"Signed in")
//   #btnSign   : button to trigger sign-in
//   #btnSignOut: button to sign out (optional)

function qs(id){ return document.getElementById(id); }

function ensureChipHost(){
  // If the expected chip DOM doesn't exist, create a minimal one to avoid crashes.
  let host = qs('chipSign');
  if (!host){
    const bar = document.querySelector('#topbar') || document.body;
    host = document.createElement('span');
    host.id = 'chipSign';
    host.style.cssText = 'display:inline-block;padding:.25rem .5rem;border-radius:12px;background:#222;color:#ddd;font:12px/1.2 system-ui;vertical-align:middle;margin-left:.5rem;';
    host.textContent = 'Sign in';
    bar.appendChild(host);
  }
  return host;
}

function refreshChip(g){
  const host = ensureChipHost();
  const authed = !!(g && g.isSignedIn && g.isSignedIn());
  host.textContent = authed ? 'Signed in' : 'Sign in';
  host.style.background = authed ? '#114d2d' : '#222';
  host.style.color = authed ? '#dff8eb' : '#ddd';
  host.dataset.authed = authed ? '1' : '0';
}

export function setupAuth(app){
  // app.auth is optional. If absent, create a minimal stub to avoid null access.
  app.auth = app.auth || {};
  const g = app.auth;

  // Wire buttons if they exist, but don't require them.
  const btnIn  = qs('btnSign');
  const btnOut = qs('btnSignOut');

  // Provide pluggable sign-in functions if none are present yet.
  g.signIn  = g.signIn  || (async ()=> { console.info('[auth] signIn stub'); refreshChip(g); });
  g.signOut = g.signOut || (async ()=> { console.info('[auth] signOut stub'); refreshChip(g); });
  g.isSignedIn = g.isSignedIn || (()=> false);

  if (btnIn){
    btnIn.addEventListener('click', async ()=>{
      try{ await g.signIn(); } finally{ refreshChip(g); }
    });
  }
  if (btnOut){
    btnOut.addEventListener('click', async ()=>{
      try{ await g.signOut(); } finally{ refreshChip(g); }
    });
  }

  // Initial paint
  refreshChip(g);
}
