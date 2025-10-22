// sheet-rename.module.js — P0 hotfix: DO NOT patch window.fetch; only install the ID sniffer.
// Keeps the existing console prefix for debug parity.
console.log("[sheet-rangefix] installed+sniffer");

// --- No fetch monkeypatch here. If a previous build replaced window.fetch and ignored init.headers,
// comment that out in your local history. This module must not touch fetch. ---

// Optional: minimal spreadsheetId sniffer stub (no-op to avoid side effects).
// If other modules dispatch 'materials:spreadsheetId', we just passively listen (nothing else required).
window.addEventListener("materials:spreadsheetId", (ev) => {
  const id = ev?.detail?.id || null;
  if (id) {
    console.log("[sheet-rangefix] spreadsheetId received:", id);
  }
}, { passive: true });
