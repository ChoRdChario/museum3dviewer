// signin.module.js — bind GIS sign-in to an existing button (no DOM injection)
import { setupAuth, bindSignInButton } from './gauth.module.js';

function tryBind() {
  setupAuth().then(() => {
    const ok = bindSignInButton();
    if (!ok) console.warn('[signin] no existing sign-in button to bind');
  }).catch(e => console.warn('[signin] setupAuth failed', e));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', tryBind, { once: true });
} else {
  tryBind();
}
