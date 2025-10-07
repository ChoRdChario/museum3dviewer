// gauth.js - patched (2025-10-07)
// Auto-detect the visible "Sign in" chip/button (prefer top-right) and unify click wiring.
// If your real GIS/GAPI sign-in function exists on window (beginGoogleSignIn / handleSignIn / signIn),
// this will call it; otherwise, it dispatches a 'auth:click' CustomEvent you can listen to.

function uniq(arr){ return Array.from(new Set(arr.filter(Boolean))); }
function isVisible(el){ return !!(el && el.offsetParent !== null); }

function findAuthChips(){
  const bySelectors = [
    '#authChip',
    '[data-auth="chip"]',
    '#topSignInBtn',
    'button.signin',
    '.auth-chip',
    '.topbar .chip',
    '.topbar button',
    'header .chip',
    'header button'
  ].flatMap(sel => Array.from(document.querySelectorAll(sel)));

  // Also try a text-based fallback inside top bar/header
  const textMatches = Array.from(document.querySelectorAll('header *, .topbar *'))
    .filter(el => /sign\s*in/i.test(el.textContent || ''));

  // Merge and keep only visible interactive-ish elements
  let candidates = uniq([...bySelectors, ...textMatches]).filter(isVisible);

  // Prefer elements in topbar/header
  const prefer = candidates.find(el => el.closest('.topbar, header'));
  if (prefer) {
    // Keep prefer first
    candidates = uniq([prefer, ...candidates]);
  }
  return candidates;
}

export function setupAuth({ chip, onReady, onSignedIn, onSignedOut } = {}) {
  // Collect chips: explicit > auto-detected
  const chips = uniq([chip, ...findAuthChips()]).filter(Boolean);
  if (!chips.length) throw new Error('[gauth] no auth chip/button found (try giving it id=\"authChip\").');

  // Primary chip is the first one (usually the top-right orange button)
  const primary = chips[0];
  const state = { signedIn: false };

  function paint(el){
    if (!el) return;
    const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button';
    const wantText = state.signedIn ? 'Signed in' : 'Sign in';
    // Class & text harmonization (non-destructive)
    try { el.classList.toggle('ok', state.signedIn); } catch {}
    try { el.classList.toggle('warn', !state.signedIn); } catch {}
    if ((el.textContent || '').trim().toLowerCase() !== wantText.toLowerCase()){
      if (!el.hasAttribute('data-auth-text-lock')) el.textContent = wantText;
    }
    if (isButton && !el.type) el.type = 'button';
    el.setAttribute('aria-pressed', state.signedIn ? 'true' : 'false');
  }

  function refreshAll(){ chips.forEach(paint); }

  async function triggerSignIn(){
    // Call your real sign-in function if present
    const fn = (window.beginGoogleSignIn || window.handleSignIn || window.signIn);
    if (typeof fn === 'function'){
      try {
        const ret = fn();
        if (ret && typeof ret.then === 'function') await ret;
        // state change should be driven by your auth callback;
        // as a visual cue we can optimistically flip, but better to wait:
        // setSignedIn(true);
      } catch (err){
        console.error('[gauth] sign-in failed', err);
      }
    } else {
      // Fallback: emit an event; your auth module can listen for it
      document.dispatchEvent(new CustomEvent('auth:click', { bubbles: true }));
      console.warn('[gauth] no sign-in function found; dispatched CustomEvent \'auth:click\'');
    }
  }

  function onChipClick(ev){
    ev.preventDefault();
    triggerSignIn();
  }

  // Wire all chips, prefer the primary location
  chips.forEach(el => {
    el.removeEventListener('click', onChipClick);
    el.addEventListener('click', onChipClick);
    el.setAttribute('data-auth-chip', ''); // mark
  });

  function setSignedIn(v){
    state.signedIn = !!v;
    refreshAll();
    if (state.signedIn) onSignedIn?.(); else onSignedOut?.();
  }

  // Initial paint
  refreshAll();
  onReady?.();

  return {
    isSignedIn(){ return !!state.signedIn; },
    setSignedIn,
    refresh: refreshAll,
    elements: chips,
    primary
  };
}
