/* LociMyu v6.6 P0 Boot Hub (ESM/CDN) — generated 2025-10-22T00:16:03
 * Responsibilities:
 *  - Bind client_id from <meta name="google-signin-client_id"> to window.__LM_CLIENT_ID
 *  - One-time auth setup (no UI)
 *  - Start spreadsheetId detection; relay via window event
 *  - Light, non-invasive: does not create or modify visible DOM
 */
(function(){
  console.log("[boot] LociMyu boot start");

  // Bind client_id to global
  try {
    const meta = document.querySelector('meta[name="google-signin-client_id"]');
    if (meta && meta.content) {
      window.__LM_CLIENT_ID = meta.content;
      console.log("[boot] client_id bound");
    } else if (typeof window.__LM_CLIENT_ID === "string" && window.__LM_CLIENT_ID.length > 0) {
      console.log("[boot] client_id already present");
    } else {
      console.warn("[gauth] client_id not found at load; waiting for runtime setup");
    }
  } catch(e) {
    console.warn("[boot] meta client_id bind failed", e);
  }

  // Lazy load modules from global namespace if bundler used; otherwise assume <script> inclusion
  // Expect these to be available: LM_GAuth, LM_SignIn, LM_SheetRename, LM_Materials

  function whenReady(cb) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", cb, {once:true});
    } else {
      cb();
    }
  }

  whenReady(async () => {
    // Setup auth (idempotent)
    if (window.LM_GAuth && typeof window.LM_GAuth.setupAuth === "function") {
      try {
        await window.LM_GAuth.setupAuth();
      } catch(e) {
        console.error("[gauth] setupAuth failed", e);
      }
    }

    // Attach Sign-in handler (idempotent)
    if (window.LM_SignIn && typeof window.LM_SignIn.attach === "function") {
      try {
        window.LM_SignIn.attach();
      } catch(e) {
        console.error("[signin] attach failed", e);
      }
    }

    // Publish spreadsheetId (single-shot)
    if (window.LM_SheetRename && typeof window.LM_SheetRename.autodetectAndPublish === "function") {
      try {
        window.LM_SheetRename.autodetectAndPublish();
      } catch(e) {
        console.error("[sheet-rename] autodetect failed", e);
      }
    }

    // Materials init (listen for spreadsheetId and prepare ensure/append)
    if (window.LM_Materials && typeof window.LM_Materials.init === "function") {
      try {
        window.LM_Materials.init();
      } catch(e) {
        console.error("[materials] init failed", e);
      }
    }

    console.log("[boot] bootOnce");
  });
})();
