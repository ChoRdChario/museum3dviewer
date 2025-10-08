
/**
 * Google Identity Services wrapper.
 * Exports:
 *   setupAuth(buttonEl, onAuthChange)
 *   getAccessToken()
 *   signOut()
 */
let tokenResponse = null;
let client = null;

export function getAccessToken() {
  return tokenResponse?.access_token || null;
}

export function signOut() {
  tokenResponse = null;
  if (typeof google !== "undefined" && google.accounts?.oauth2) {
    try { google.accounts.oauth2.revoke(getAccessToken()); } catch {}
  }
}

export function setupAuth(buttonEl, onAuthChange) {
  // Fallback stub if GIS is not loaded yet
  if (typeof google === "undefined" || !google.accounts?.oauth2) {
    console.warn("[auth] Google Identity Services not loaded; using stub");
    buttonEl.onclick = async () => {
      console.log("[auth] sign-in clicked (stub)");
      onAuthChange(false, null);
    };
    return;
  }

  const scope = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file"
  ].join(" ");

  client = google.accounts.oauth2.initTokenClient({
    client_id: "%GOOGLE_OAUTH_CLIENT_ID%",
    scope,
    callback: (resp) => {
      tokenResponse = resp;
      onAuthChange(true, resp);
    }
  });

  const updateLabel = () => {
    buttonEl.textContent = tokenResponse ? "Sign out" : "Sign in";
  };

  updateLabel();

  buttonEl.onclick = async () => {
    if (!tokenResponse) {
      client.requestAccessToken();
    } else {
      signOut();
      onAuthChange(false, null);
      updateLabel();
    }
  };
}
