// config.js (single source of truth for public build settings)
// Edit this file when switching environments (dev/prod).
(function(){
  const cfg = {
    build: {
      product: "LociMyu",
      channel: "alpha",
      version: "α.2025-12-17",
    },
    google: {
      clientId: "157105746935-b594qhhg9a6utksl9ojdf8rrapv38bap.apps.googleusercontent.com",
      apiKey: "AIzaSyBv-YOqv_Ky61rBJtEmdP-n8auZkQ4lye4",
    },
  };

  // Expose for app code
  window.__LM_CONFIG = Object.assign(window.__LM_CONFIG||{}, cfg);
  window.__LM_CLIENT_ID = cfg.google.clientId;
  window.__LM_API_KEY = cfg.google.apiKey;

  // Policy: drive.file only (no folder scanning / no broad Drive access)
  window.__LM_POLICY_DRIVEFILE_ONLY = true;

  // Keep legacy DOM hooks in sync (some modules read from meta tags)
  function setMeta(name, content){
    let m = document.querySelector('meta[name="' + name + '"]');
    if (!m) {
      m = document.createElement("meta");
      m.name = name;
      document.head.appendChild(m);
    }
    m.content = String(content || "");
  }

  try {
    if (cfg.google.clientId) {
      setMeta("google-oauth-client_id", cfg.google.clientId);
      setMeta("google-signin-client_id", cfg.google.clientId);
    }
    if (cfg.google.apiKey) {
      setMeta("google-api-key", cfg.google.apiKey);
    }
  } catch(e) {}
})();
