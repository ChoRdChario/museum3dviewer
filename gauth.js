// gauth.js - patched (2025-10-07)
// Defensive default for chip and clear error if missing.
// NOTE: Replace placeholders with your real GIS/GAPI sign-in flow.

export function setupAuth({ chip = document.getElementById('authChip'), onReady, onSignedIn, onSignedOut } = {}) {
  if (!chip) throw new Error('[gauth] auth chip element not found (id="authChip").');

  const state = { signedIn: false };

  function refreshChip() {
    chip.className = state.signedIn ? 'chip ok' : 'chip warn';
    chip.textContent = state.signedIn ? 'Signed in' : 'Sign in';
  }

  // Hook up a click handler (replace with your actual sign-in trigger)
  chip.addEventListener('click', () => {
    // Example stub:
    // beginGoogleSignIn()
    //   .then(() => { state.signedIn = true; refreshChip(); onSignedIn?.(); })
    //   .catch(err => console.error('[auth] sign-in failed', err));
  });

  // Initial paint
  refreshChip();
  onReady?.();

  // Public API (if needed elsewhere)
  return {
    refreshChip,
    setSignedIn(v) { state.signedIn = !!v; refreshChip(); v ? onSignedIn?.() : onSignedOut?.(); },
    isSignedIn() { return !!state.signedIn; }
  };
}
