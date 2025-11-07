/* caption.ui.patch.js — restore caption pane DOM (non-invasive) */
(() => {
  const TAG = "[cap-ui]";
  const log = (...a)=>console.log(TAG, ...a);
  const warn = (...a)=>console.warn(TAG, ...a);

  // Find right pane & caption tab panel
  const right =
    document.getElementById("right") ||
    document.querySelector("#right,aside,.right,.sidebar") ||
    document.body;

  const pane =
    document.getElementById("pane-caption") ||
    right.querySelector('#pane-caption,[data-panel="caption"],[role="tabpanel"][data-tab="caption"]');

  if (!pane) return warn("pane-caption not found");

  // If app already rendered, do nothing
  if (pane.querySelector("#caption-root")) return log("caption-root already present");

  // Build DOM expected by existing app logic (IDs kept stable)
  const root = document.createElement("div");
  root.id = "caption-root";
  root.className = "lm-caption-root";

  root.innerHTML = `
  <div class="field">
    <label class="label">Pin color</label>
    <div id="pinColorRow" class="chip-row" aria-label="pin color chips"></div>
  </div>

  <div class="field">
    <label class="label">Filter</label>
    <div id="filterRow" class="filter-row">
      <button id="filterAll" class="btn small" type="button">All</button>
      <button id="filterNone" class="btn small" type="button">None</button>
      <div id="filterColors" class="chip-row" aria-label="color filters"></div>
    </div>
  </div>

  <div class="field">
    <label class="label">Caption list</label>
    <div id="captionList" class="list" role="listbox" aria-label="captions"></div>
  </div>

  <div class="field two-cols">
    <div>
      <label class="label">Title</label>
      <input id="capTitle" type="text" class="input" placeholder="Title">
    </div>
    <div>
      <label class="label">Body</label>
      <textarea id="capBody" class="textarea" rows="3" placeholder="Body"></textarea>
    </div>
  </div>

  <div class="field">
    <label class="label">Images (auto from GLB folder)</label>
    <button id="btnRefreshImages" class="btn" type="button">Refresh images</button>
    <div id="imageStrip" class="image-strip" aria-label="images"></div>
  </div>
  `;

  pane.appendChild(root);
  log("caption-root injected into", pane);

  // Minimal styles to avoid layout breakage; app CSS can override
  const css = document.createElement("style");
  css.textContent = `
    .lm-caption-root { display: grid; gap: 10px; }
    .field .label { display:block; font-size:.85rem; opacity:.8; margin-bottom:4px; }
    .chip-row { display: flex; gap: 6px; flex-wrap: wrap; }
    .filter-row { display:flex; gap:8px; align-items:center; flex-wrap: wrap; }
    .list { min-height: 120px; max-height: 260px; overflow: auto; background: rgba(255,255,255,.03); border-radius: 8px; padding: 6px; }
    .two-cols { display:grid; grid-template-columns: 1fr; gap:8px; }
    .input, .textarea { width:100%; }
    .btn.small { padding: 2px 8px; font-size: .8rem; }
    .image-strip { display:flex; gap:8px; overflow:auto; padding:6px 0; }
  `;
  document.head.appendChild(css);
})();