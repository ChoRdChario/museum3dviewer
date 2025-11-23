// material.orchestrator.js
// LociMyu material UI orchestrator (Unified)
// Integrates full-scene application (replacing auto.apply.js) and direct DOM event handling.
// VERSION_TAG: V6_UNIFIED_ORCHESTRATOR_V1

(function () {
  const LOG_PREFIX = '[mat-orch-unified]';
  const RETRY_MS = 250;
  const RETRY_MAX = 40;
  const MATERIALS_RANGE = '__LM_MATERIALS!A:N';

  // UI State
  let ui = null;
  let retryCount = 0;
  let listenersBound = false;

  // Data State
  let currentSheetGid = '';
  // Cache: sheetGid -> Map<materialKey, PropsObject>
  const sheetMaterialCache = new Map();
  let currentOpacity = 1;
  
  // Debounce for persist
  const persistDebounce = new Map(); // key -> timerId

  const defaultProps = {
    opacity: 1,
    doubleSided: false,
    unlitLike: false,
    chromaEnable: false,
    chromaColor: '#000000',
    chromaTolerance: 0,
    chromaFeather: 0,
  };

  // --- UI Helpers ---

  function queryUI() {
    return {
      materialSelect: document.getElementById('materialSelect') || document.getElementById('pm-material'),
      opacityRange: document.getElementById('opacityRange') || document.getElementById('pm-opacity-range'),
      opacityVal: document.getElementById('pm-opacity-val') || document.getElementById('pm-value'),
      
      // Flags / Advanced
      chkDoubleSided: document.getElementById('pm-flag-doublesided'),
      chkUnlitLike: document.getElementById('pm-flag-unlit'),
      chkChromaEnable: document.getElementById('pm-chroma-enable'),
      inpChromaColor: document.getElementById('pm-chroma-color'),
      rngChromaTolerance: document.getElementById('pm-chroma-tol'),
      rngChromaFeather: document.getElementById('pm-chroma-feather')
    };
  }

  function getSelectedMaterialKey() {
    if (!ui) ui = queryUI();
    return ui.materialSelect ? (ui.materialSelect.value || '').trim() : '';
  }

  function clamp(v, min, max) {
    return Math.min(Math.max(Number(v), min), max);
  }

  /**
   * Update UI elements based on props
   * Updates BOTH the slider and the text readout directly.
   */
  function applyPropsToUI(props) {
    if (!ui) ui = queryUI();
    const p = Object.assign({}, defaultProps, props || {});

    // Opacity
    if (ui.opacityRange) ui.opacityRange.value = String(p.opacity);
    
    // Text readout update
    if (ui.opacityVal) {
      const disp = Number(p.opacity).toFixed(2);
      if (ui.opacityVal.tagName === 'INPUT' || ui.opacityVal.tagName === 'OUTPUT') {
        ui.opacityVal.value = disp;
      } else {
        ui.opacityVal.textContent = disp;
      }
    }

    // Advanced props
    if (ui.chkDoubleSided) ui.chkDoubleSided.checked = !!p.doubleSided;
    if (ui.chkUnlitLike) ui.chkUnlitLike.checked = !!p.unlitLike;
    if (ui.chkChromaEnable) ui.chkChromaEnable.checked = !!p.chromaEnable;
    if (ui.inpChromaColor) ui.inpChromaColor.value = p.chromaColor || '#000000';
    if (ui.rngChromaTolerance) ui.rngChromaTolerance.value = String(p.chromaTolerance || 0);
    if (ui.rngChromaFeather) ui.rngChromaFeather.value = String(p.chromaFeather || 0);
  }

  /**
   * Collect current values from UI
   */
  function collectControls() {
    if (!ui) ui = queryUI();
    const opacity = ui.opacityRange ? Number(ui.opacityRange.value) : 1;
    
    const props = {
      opacity: clamp(opacity, 0, 1),
      doubleSided: ui.chkDoubleSided ? ui.chkDoubleSided.checked : false,
      unlitLike: ui.chkUnlitLike ? ui.chkUnlitLike.checked : false,
      chromaEnable: ui.chkChromaEnable ? ui.chkChromaEnable.checked : false,
      chromaColor: ui.inpChromaColor ? ui.inpChromaColor.value : '#000000',
      chromaTolerance: ui.rngChromaTolerance ? Number(ui.rngChromaTolerance.value) : 0,
      chromaFeather: ui.rngChromaFeather ? Number(ui.rngChromaFeather.value) : 0
    };

    return {
      materialKey: getSelectedMaterialKey(),
      props
    };
  }

  // --- Scene / Bridge Interaction ---

  function getViewerBridge() {
    return window.__lm_viewer_bridge || window.viewerBridge;
  }

  function applyToViewer(key, props) {
    const bridge = getViewerBridge();
    if (bridge && typeof bridge.applyMaterialProps === 'function') {
      bridge.applyMaterialProps(key, props);
    }
  }

  /**
   * REPLACEMENT for auto.apply.js
   * Apply ALL cached settings to the ENTIRE scene.
   */
  function applyAllToScene(map) {
    const scene = window.__LM_SCENE || window.scene || (window.viewer && window.viewer.scene);
    const THREE = window.THREE;
    if (!scene || !THREE) return;

    // Use viewer bridge if available for safer application, 
    // but fall back to direct traversal (like auto.apply.js did) if needed.
    // Since we have a robust applyToViewer, we can iterate the map and call it.
    // However, iterating the map only covers materials IN the sheet. 
    // We should also cover materials NOT in the sheet (defaults).
    
    // For efficiency, let's stick to the auto.apply logic: traverse scene and look up in map.
    scene.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      
      mats.forEach(m => {
        if (!m) return;
        const key = (m.name || o.name || '').trim();
        if (!key) return;

        // If in map, use it. If not, maybe use default? 
        // Auto.apply only applied *existing* configs. Let's do that.
        if (map.has(key)) {
          const conf = map.get(key);
          
          // Direct THREE application (mimicking auto.apply)
          // OR use bridge. The bridge is safer because it handles shaders/uniforms.
          applyToViewer(key, conf);
        }
      });
    });
    console.log(LOG_PREFIX, 'Applied full configuration to scene.');
  }

  // --- Persistence ---

  function persistToSheet(key, props) {
    const persist = window.LM_MaterialsPersist;
    if (!persist || typeof persist.upsert !== 'function') return;

    const patch = Object.assign({ materialKey: key, sheetGid: currentSheetGid }, props);
    persist.upsert(patch).catch(e => console.warn(LOG_PREFIX, 'Persist failed', e));
  }

  // --- Core Sync Logic ---

  /**
   * Sync UI and Viewer for the currently selected material.
   * Called on Dropdown Change or after Sheet Load.
   */
  function syncMaterialState(key) {
    if (!key) return;
    
    const cache = sheetMaterialCache.get(currentSheetGid);
    const cachedProps = cache ? cache.get(key) : null;
    
    // Fallback to default if not in cache
    const finalProps = cachedProps ? Object.assign({}, cachedProps) : Object.assign({}, defaultProps);
    
    applyPropsToUI(finalProps);
    applyToViewer(key, finalProps);
    
    console.log(LOG_PREFIX, 'Synced Single:', key, cachedProps ? '(Cached)' : '(Default)');
  }

  // --- Data Fetching ---

  async function fetchAndCacheMaterials(spreadsheetId, sheetGid) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    if (!fetchAuth || !spreadsheetId) return new Map();

    const range = encodeURIComponent(MATERIALS_RANGE);
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`;
    
    try {
      const res = await fetchAuth(url);
      const rows = res.values || [];
      const map = new Map();
      
      // Parse Rows (A=0 ... N=13)
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const mKey = (r[0] || '').trim();
        const mGid = (r[13] || '').trim(); // Column N is sheetGid
        
        // Only load rows that match current Sheet GID
        if (mKey && mGid === sheetGid) {
           map.set(mKey, {
             opacity: r[1] !== undefined ? parseFloat(r[1]) : 1,
             doubleSided: (r[2]||"").toUpperCase() === "TRUE",
             unlitLike: (r[3]||"").toUpperCase() === "TRUE",
             chromaEnable: (r[4]||"").toUpperCase() === "TRUE",
             chromaColor: r[5] || "#000000",
             chromaTolerance: parseFloat(r[6]||"0"),
             chromaFeather: parseFloat(r[7]||"0"),
           });
        }
      }
      return map;
    } catch (e) {
      console.warn(LOG_PREFIX, 'Fetch failed', e);
      return new Map();
    }
  }

  function handleSheetContextChange(ctx) {
    const newSid = ctx.spreadsheetId || '';
    const newGid = String(ctx.sheetGid !== undefined ? ctx.sheetGid : '');

    currentSheetGid = newGid;
    console.log(LOG_PREFIX, 'Sheet Context Change ->', newGid);

    // 1. Clear current cache to avoid mixing data
    sheetMaterialCache.delete(newGid);

    // 2. Fetch
    fetchAndCacheMaterials(newSid, newGid).then(map => {
      // Check if context changed while fetching
      if (currentSheetGid !== newGid) return;

      sheetMaterialCache.set(newGid, map);
      console.log(LOG_PREFIX, 'Data Loaded. Keys:', map.size);

      // 3. Apply to WHOLE SCENE (Replacing auto.apply)
      applyAllToScene(map);

      // 4. Update UI for the currently selected dropdown item
      const key = getSelectedMaterialKey();
      if (key) {
        syncMaterialState(key);
      }
    });
  }

  // --- Direct DOM Event Binding ---

  function bindDirectEvents() {
    if (listenersBound) return;
    if (!ui) ui = queryUI();
    if (!ui.materialSelect) return; // Not ready yet

    listenersBound = true;
    console.log(LOG_PREFIX, 'Binding Direct DOM Events');

    // 1. Material Select Change
    ui.materialSelect.addEventListener('change', () => {
      const key = getSelectedMaterialKey();
      console.log(LOG_PREFIX, 'Select Change:', key);
      syncMaterialState(key);
    });

    // 2. Opacity Input (Slider Dragging) -> Live Preview, NO SAVE
    if (ui.opacityRange) {
      ui.opacityRange.addEventListener('input', () => {
        const state = collectControls();
        if (state.materialKey) {
          // Update text readout manually for speed
          if (ui.opacityVal) ui.opacityVal.textContent = Number(state.props.opacity).toFixed(2);
          
          applyToViewer(state.materialKey, state.props);
        }
      });

      // 3. Opacity Change (Drag End) -> SAVE
      ui.opacityRange.addEventListener('change', () => {
        const state = collectControls();
        if (state.materialKey) {
          console.log(LOG_PREFIX, 'Slider Commit:', state.materialKey);
          applyToViewer(state.materialKey, state.props);
          persistToSheet(state.materialKey, state.props);
          
          // Update local cache so we don't revert on next sync
          const cache = sheetMaterialCache.get(currentSheetGid) || new Map();
          cache.set(state.materialKey, state.props);
          sheetMaterialCache.set(currentSheetGid, cache);
        }
      });
    }

    // 4. Checkboxes / Colors -> Change -> Save
    const bindChange = (el) => {
      if (!el) return;
      el.addEventListener('change', () => {
        const state = collectControls();
        if (state.materialKey) {
           applyToViewer(state.materialKey, state.props);
           persistToSheet(state.materialKey, state.props);
           
           const cache = sheetMaterialCache.get(currentSheetGid) || new Map();
           cache.set(state.materialKey, state.props);
           sheetMaterialCache.set(currentSheetGid, cache);
        }
      });
    };
    
    [ui.chkDoubleSided, ui.chkUnlitLike, ui.chkChromaEnable, ui.inpChromaColor, 
     ui.rngChromaTolerance, ui.rngChromaFeather].forEach(bindChange);
  }

  // --- Boot ---

  function boot() {
    // Listen for Sheet Context
    window.addEventListener('lm:sheet-context', (e) => {
      if (e.detail) handleSheetContextChange(e.detail);
    });
    if (window.__LM_SHEET_CTX) {
      handleSheetContextChange(window.__LM_SHEET_CTX);
    }

    // Try binding to DOM
    const t = setInterval(() => {
      const res = queryUI();
      if (res.materialSelect) {
        bindDirectEvents();
        
        // Initial sync if something is already selected
        const key = getSelectedMaterialKey();
        if (key && currentSheetGid) syncMaterialState(key);

        clearInterval(t);
      } else if (retryCount++ > 50) {
        console.warn(LOG_PREFIX, 'UI bind timeout');
        clearInterval(t);
      }
    }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

})();
}