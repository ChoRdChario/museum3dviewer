// locimyu.config.js — injected before gauth.module.js & boot.esm.cdn.js
// CLIENT_ID/API_KEY are already set below. If you change the client, update here.
window.GIS_CLIENT_ID = window.GIS_CLIENT_ID || "595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com";
window.GIS_API_KEY   = window.GIS_API_KEY   || "AIzaSyCUnTCr5yWUWPdEXST9bKP1LpgawU5rIbI";
window.GIS_SCOPES = (window.GIS_SCOPES || [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/drive.metadata.readonly",
  "https://www.googleapis.com/auth/spreadsheets"
].join(' '));

// Optional: window.GIS_PROMPT = "consent";
// Optional: window.GIS_HINT = "<youremail@example.com>";

// If you always want a fixed parent Drive folder for spreadsheets, set it here.
// Otherwise, the app will try to derive the GLB's parent folder dynamically.
window.LM_PARENT_FOLDER_ID = window.LM_PARENT_FOLDER_ID || "";

// Clear any cached spreadsheet id to force fresh lookup after auth change.
try { window.currentSpreadsheetId = null; localStorage.removeItem('lm:ssid'); } catch(e) {}

// Bind the client_id into meta + __LM_CLIENT_ID early and notify gauth.
(function bindClientMeta(){
  try {
    const id = (window.GIS_CLIENT_ID || window.__LM_CLIENT_ID || '').trim();
    if (!id) return;
    let meta = document.querySelector("meta[name='google-signin-client_id']");
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "google-signin-client_id");
      document.head.appendChild(meta);
    }
    meta.setAttribute("content", id);
    window.__LM_CLIENT_ID = id;
    try { window.dispatchEvent(new CustomEvent('materials:clientId', {detail:{client_id:id}})); } catch {}
  } catch(e) { console.warn('[config] bind meta failed', e); }
})();
