// gauth.js - patched guard for missing chip (2025-10-07)

// This file assumes your existing auth logic (GIS/GAPI) is elsewhere.
// We only add a defensive default parameter and a clear error if the chip is missing.

export function setupAuth({ chip = document.getElementById('authChip'), onReady, onSignedIn, onSignedOut } = {}) {
  const state = { signedIn: false };

  function refreshChip() {
    if (!chip) throw new Error('[gauth] auth chip element not found (id="authChip").');
    // Keep your original class names/texts if they differ:
    chip.className = state.signedIn ? 'chip ok' : 'chip warn';
    chip.textContent = state.signedIn ? 'Signed in' : 'Sign in';
  }

  // If you already attach event listeners elsewhere, you can remove this.
  // This is a harmless fallback that only updates UI; replace with your real sign-in handler.
  chip?.addEventListener('click', () => {
    // noop placeholder; your real sign-in flow should run here
    // Example: beginGoogleSignIn().then(() => { state.signedIn = true; refreshChip(); onSignedIn?.(); });
  });

  // Initial paint
  refreshChip();
  onReady?.();

  return {
    refreshChip,
    setSignedIn(v) { state.signedIn = !!v; refreshChip(); },
    isSignedIn() { return !!state.signedIn; }
  };
}
