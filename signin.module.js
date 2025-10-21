
// signin.module.js — Wire ONLY existing "Sign in" button. Remove any GSI-rendered buttons.
// Full file.

import { setupAuth, signIn } from './gauth.module.js';

const LOG_NS = '[signin]';

function log(...a){ console.log(LOG_NS, ...a); }
function warn(...a){ console.warn(LOG_NS, ...a); }

/** Remove any auto-rendered Google Sign-In UI elements and duplicate buttons. */
function purgeGoogleButtons() {
  try {
    const selectors = [
      '#g_id_onload',
      '.g_id_signin',
      '[id^="gsi_"]',
      '[id^="g_id"]',
      'iframe[src*="accounts.google.com/gsi/"]'
    ];
    selectors.forEach(sel => document.querySelectorAll(sel).forEach(n => n.remove()));
    // Also remove extra <button> that says "Google でサインイン" / "Sign in with Google" etc.
    document.querySelectorAll('button, div[role="button"]').forEach(el => {
      const t = (el.textContent || '').trim();
      if (!t) return;
      const hit = /google\s*でサインイン|sign\s*in\s*with\s*google/i.test(t);
      if (hit) el.remove();
    });
  } catch {}
}

/** Find existing app's "Sign in" button (by id, data-role or label) */
function findExistingSigninButton() {
  const byId = document.getElementById('signin');
  if (byId) return byId;
  const byRole = document.querySelector('[data-role="signin"]');
  if (byRole) return byRole;
  // Fallback by label (avoid Google button which we removed above)
  const candidates = Array.from(document.querySelectorAll('button, div[role="button"], a.button'));
  for (const el of candidates) {
    const t = (el.textContent || '').trim();
    if (/^sign\s*in$/i.test(t)) return el;
  }
  return null;
}

/** Ensure client_id is visible to gauth; read from meta if needed */
function propagateClientIdFromMeta() {
  try {
    if (window.__LM_CLIENT_ID) return;
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) window.__LM_CLIENT_ID = meta.content.trim();
  } catch {}
}

async function attach() {
  purgeGoogleButtons();
  propagateClientIdFromMeta();

  // Init auth (non-fatal if client_id still missing; user may set later)
  try {
    await setupAuth();
  } catch (e) {
    warn('setupAuth error', e);
  }

  const btn = findExistingSigninButton();
  if (!btn) { warn('existing Sign in button not found'); return; }

  // Avoid double-binding
  if (btn.__lmWired) return;
  btn.__lmWired = true;

  btn.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      await signIn();
      log('signed in');
    } catch (e) {
      warn('signIn failed', e);
    }
  });

  log('wired to existing Sign in button');
}

function domReady(fn){
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(fn, 0);
  } else {
    document.addEventListener('DOMContentLoaded', fn, {once:true});
  }
}

domReady(attach);
