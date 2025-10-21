// signin.module.js
// Bind ONLY to the existing "Sign in" button. Never create or render another button.
// Also remove any stray Google Sign-In button injected in previous builds.

import { signIn, setupAuth } from './gauth.module.js';

function _log(...a){ console.log('[signin]', ...a); }

function _isStrayGoogleButton(el){
  if(!el) return false;
  if (el.id && (el.id.startsWith('g_id') || el.id.startsWith('gsi_'))) return true;
  if (el.classList && (el.classList.contains('g_id_signin'))) return true;
  const txt = (el.textContent || '').trim();
  if (txt && /google/i.test(txt) && !/sign in/i.test(txt)) return true;
  return false;
}

function removeStrayGoogleButtons(){
  const guesses = [
    '#__lmSignIn','#g_id_onload','.g_id_signin','[id^="gsi_"]','[id^="g_id"]',
    'div[role="button"][data-lm-gis-button]'
  ];
  guesses.forEach(sel => document.querySelectorAll(sel).forEach(n => n.remove()));

  // Fallback: look for suspicious floating white buttons
  document.querySelectorAll('button, div[role="button"]').forEach(el => {
    if (_isStrayGoogleButton(el)) { el.remove(); }
  });
}

function findExistingSignInButton(){
  // Prefer explicit ids/data-roles
  const byId = document.getElementById('signin');
  if (byId) return byId;
  const byRole = document.querySelector('[data-role="signin"], [data-action="signin"]');
  if (byRole) return byRole;
  // Fallback: English label "Sign in"
  const btns = Array.from(document.querySelectorAll('button, .btn, [role="button"]'));
  const cand = btns.find(b => (b.textContent||'').trim().toLowerCase() === 'sign in');
  return cand || null;
}

export async function wireSignIn(){
  await setupAuth(); // initialize silently; does not render anything

  removeStrayGoogleButtons();

  const btn = findExistingSignInButton();
  if (!btn){
    _log('no existing "Sign in" button found to wire');
    return;
  }
  // Avoid duplicate handlers
  btn.removeEventListener('click', btn.__lmSignInHandler);
  btn.__lmSignInHandler = async (ev) => {
    ev.preventDefault();
    try{
      await signIn();
      _log('signed in');
      btn.classList.add('is-signed-in');
    }catch(e){
      console.warn('[signin] failed:', e?.message || e);
    }
  };
  btn.addEventListener('click', btn.__lmSignInHandler, {passive:false});
  _log('wired to existing Sign in button');
}

// auto-wire on DOM ready
if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', wireSignIn, {once:true});
}else{
  wireSignIn();
}
