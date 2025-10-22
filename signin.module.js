// signin.module.js — minimal wiring only (keep current architecture as-is)
import { setupAuth } from "./gauth.module.js";

function resolveClientId() {
  const meta = document.querySelector('meta[name="google-oauth-client_id"],meta[name="google-signin-client_id"]');
  if (meta && meta.content) return meta.content;
  if (window.GIS_CLIENT_ID) return window.GIS_CLIENT_ID;
  if (window.__LM_CLIENT_ID) return window.__LM_CLIENT_ID || "";
  return "";
}

// Public API (same name to avoid breaking imports elsewhere)
export function attach() {
  // Find the existing button (no DOM creation)
  const btn =
    document.querySelector('[data-lm-signin]')
    || document.getElementById("auth-signin")
    || document.getElementById("signin")
    || document.querySelector(".btn-signin, button.signin");

  if (!btn) {
    console.warn("[signin] sign-in button not found");
    return;
  }
  if (btn.__lm_bound) return; // idempotent
  btn.__lm_bound = true;

  // Client ID bridge (do not change global shape)
  const clientId = resolveClientId();
  if (clientId && !window.__LM_CLIENT_ID) window.__LM_CLIENT_ID = clientId;

  // Wire to existing gauth (onSigned is a no-op; viewer side handles UI)
  try {
    setupAuth(btn, () => {}, { clientId });
    console.log("[signin] attached to", btn);
  } catch (e) {
    console.error("[signin] setupAuth failed", e);
  }
}

// Auto-attach after DOM is ready (keeps previous behavior stable)
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", attach, { once: true });
} else {
  attach();
}
