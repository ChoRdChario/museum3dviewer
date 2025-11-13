// auth.fetch.bridge.js
// Minimal, dependency-free bridge that exposes window.__lm_fetchJSONAuth
// so modules like save.locator.js can rely on it uniformly.
// Loads token via gauth.module.js dynamically to avoid import-order problems.

const AUTH_TAG = "[auth.bridge]";

function setGlobal(name, value){
  try { Object.defineProperty(window, name, { value, writable: false, configurable: true }); }
  catch(_) { window[name] = value; }
}

export async function ensureAuthBridge(timeoutMs = 8000){
  if (typeof window !== "undefined" && typeof window.__lm_fetchJSONAuth === "function") {
    return window.__lm_fetchJSONAuth;
  }
  // Dynamically import gauth so we don't depend on script order
  let gauth;
  try {
    gauth = await import('./gauth.module.js');
  } catch (e) {
    console.warn(AUTH_TAG, "gauth.module.js import failed:", e);
    throw new Error("__lm_fetchJSONAuth not available (gauth import failed)");
  }

  if (!gauth || typeof gauth.getAccessToken !== "function"){
    console.warn(AUTH_TAG, "getAccessToken not found on gauth.module.js");
    throw new Error("__lm_fetchJSONAuth not available (getAccessToken missing)");
  }

  const fetchJSONAuth = async (url, init = {}) => {
    // get token each call to keep it fresh
    const token = await gauth.getAccessToken();
    if (!token) {
      throw new Error("No OAuth token (getAccessToken returned falsy)");
    }
    const headers = new Headers(init.headers || {});
    headers.set("Authorization", `Bearer ${token}`);
    // If body is a plain object, serialize and set JSON headers
    let body = init.body;
    if (body && typeof body === "object" && !(body instanceof Blob) && !(body instanceof ArrayBuffer)) {
      headers.set("Content-Type", "application/json; charset=utf-8");
      body = JSON.stringify(body);
    }
    const res = await fetch(url, { ...init, headers, body });
    if (!res.ok) {
      let msg;
      try { msg = await res.text(); } catch(_) { msg = String(res.status); }
      const err = new Error(`HTTP ${res.status} :: ${msg}`);
      err.status = res.status;
      err.body = msg;
      throw err;
    }
    const ctype = res.headers.get("content-type") || "";
    if (ctype.includes("application/json")) {
      return await res.json();
    }
    return await res.text();
  };

  setGlobal("__lm_fetchJSONAuth", fetchJSONAuth);
  try { window.dispatchEvent(new Event("lm:auth-ready")); } catch(_){}
  console.log(AUTH_TAG, "ready");
  return fetchJSONAuth;
}

export default ensureAuthBridge;
