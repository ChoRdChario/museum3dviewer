
// gauth.js — unified Sign in chip/button with safe stubs and no-duplicate UI
// Exports: setupAuth(app)
function qs(x){ return document.getElementById(x); }
function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }

function ensureChip(){
  let chip = qs('chipSign');
  if (!chip){
    // Reuse existing top-right "Sign in" chip if present; otherwise create one.
    const topbar = document.querySelector('#topbar,.topbar,.header') || document.body;
    chip = document.createElement('button');
    chip.id = 'chipSign';
    chip.type = 'button';
    chip.dataset.role = 'signin';
    chip.style.cssText = 'margin-left:.5rem;padding:.25rem .6rem;border-radius:999px;background:#222;color:#ddd;border:1px solid #444;cursor:pointer;';
    chip.textContent = 'Sign in';
    topbar.appendChild(chip);
  }
  return chip;
}

function setChipState(authed){
  const chip = ensureChip();
  chip.textContent = authed ? 'Signed in' : 'Sign in';
  chip.style.background = authed ? '#114d2d' : '#222';
  chip.style.color = authed ? '#e8fff3' : '#ddd';
  chip.dataset.authed = authed ? '1' : '0';
}

function pulse(el){
  if (!el) return;
  el.style.transform = 'scale(0.98)';
  setTimeout(()=>{ el.style.transform = 'scale(1)'; }, 120);
}

export function setupAuth(app){
  app.auth = app.auth || {};
  const a = app.auth;

  // allow host app to provide real methods; otherwise use stubs
  a.isSignedIn = a.isSignedIn || (() => !!a.__signed);
  a.signIn = a.signIn || (async ()=>{ a.__signed = true; });
  a.signOut= a.signOut|| (async ()=>{ a.__signed = false; });

  // unify all buttons with role markers or known IDs
  const buttonsIn  = qsa('[data-role="signin"], #btnSign, #chipSign').filter(Boolean);
  const buttonsOut = qsa('[data-role="signout"], #btnSignOut').filter(Boolean);

  // dedupe same element if overlapping selectors
  const inSet  = Array.from(new Set(buttonsIn));
  const outSet = Array.from(new Set(buttonsOut));

  function refresh(){ setChipState(a.isSignedIn()); 
    // sync any secondary button label if it shows text
    inSet.forEach(btn=>{ if (btn && btn.id!=='chipSign') btn.textContent = a.isSignedIn() ? 'Signed in' : 'Sign in'; });
  }

  inSet.forEach(btn=> btn.addEventListener('click', async ()=>{
    pulse(btn);
    try{ await a.signIn(); } finally{ refresh(); }
  }));
  outSet.forEach(btn=> btn.addEventListener('click', async ()=>{
    pulse(btn);
    try{ await a.signOut(); } finally{ refresh(); }
  }));

  // initial paint
  refresh();
}
