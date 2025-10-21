// signin.module.js — do not create extra buttons; reuse existing UI.
// It binds the first matching element to the GIS auth flow.
import { setupAuth, ensureToken } from './gauth.module.js';

const SELECTORS = [
  '#signin',              // legacy id
  '[data-role="signin"]',
  '.g-signin',            // legacy class
  '#google-signin',       // common id
];

function findButton() {
  for (const sel of SELECTORS) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  // Fallback to the first button that looks like Google sign-in
  return Array.from(document.querySelectorAll('button,input[type="button"]'))
    .find(b => /google/i.test(b.textContent||b.value||''));
}

export async function wireSignIn() {
  const btn = findButton();
  if (!btn) {
    console.warn('[signin] no button found to bind');
    return false;
  }
  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await setupAuth();
      await ensureToken(true);
    } catch(e) {
      console.warn('[signin] failed:', e?.message || e);
    }
  }, { passive:false });
  return true;
}

// auto-wire on module load (non-fatal)
wireSignIn().catch(()=>{});
