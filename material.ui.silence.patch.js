
/*!
 * material.ui.silence.patch.js
 * v2  — Robust "selection-switch silence" overlay for LociMyu
 *
 * Goal
 *  - During material selection changes, block programmatic 'input'/'change'
 *    events produced by UI sync so the previous material's UI state does not
 *    bleed into the newly selected material.
 *  - Zero invasive: no edits to material.orchestrator.js.
 *
 * How it works
 *  - On '#pm-material' (or aria-label) change: sets a short "silence window"
 *    (~220ms). Within that window, a capturing listener on document intercepts
 *    'input' & 'change' from controls inside the Material panel and
 *    stopImmediatePropagation + preventDefault.
 *  - We also record last real user intent (pointer/keyboard) and only allow
 *    events to pass if they are both (a) inside the panel and (b) close in
 *    time to the user action on the same element (<= 400ms). This prevents
 *    synthetic dispatches from the orchestrator during rebind from leaking.
 *
 * Safe to include after material.orchestrator.js via a plain <script> tag.
 */
(() => {
  const LOG_PREFIX = "[silence-patch v2]";
  try {
    if (window.__LM_MAT_SILENCE_V2_INSTALLED__) {
      console.log(LOG_PREFIX, "already installed");
      return;
    }
    window.__LM_MAT_SILENCE_V2_INSTALLED__ = true;

    // --- helpers -----------------------------------------------------------
    const now = () => performance.now();
    const selMaterial = () =>
      document.querySelector('#pm-material, select[aria-label="Select material"]');

    // Try to approximate "Material panel" container for scoping
    const findPanel = () => {
      const sel = selMaterial();
      if (!sel) return document;
      const candidates = [ '[role="tabpanel"]', '.tab-body', '.card', '.panel', '.material-pane', '.material-panel' ];
      for (const c of candidates) {
        const n = sel.closest(c);
        if (n) return n;
      }
      // Fallback: two levels up is often the card body
      return sel.parentElement?.parentElement || document;
    };

    // Global state
    let silenceUntil = 0;
    let lastUser = { t: 0, el: null };

    const isInsidePanel = (el) => !!el && findPanel().contains(el);

    // Capture genuine user intent early
    const rememberUser = (ev) => {
      lastUser = { t: now(), el: ev.target };
    };
    document.addEventListener('pointerdown', rememberUser, true);
    document.addEventListener('keydown', rememberUser, true);

    // Hard guard to mute synthetic/bubbled UI writes during silence window
    const guardCapture = (ev) => {
      if (!isInsidePanel(ev.target)) return;
      const t = now();
      const isSilent = t < silenceUntil;

      // If there's recent direct user intent on this same element, let it pass.
      const recentUser =
        lastUser.el === ev.target && (t - lastUser.t) <= 400;

      if (isSilent && !recentUser) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        // Optional: avoid log flood, pulse once per 60ms
        if (!guardCapture.__lastLog || (t - guardCapture.__lastLog) > 60) {
          console.debug(LOG_PREFIX, "blocked", ev.type, "on", ev.target?.id || ev.target?.name || ev.target?.className || ev.target?.tagName);
          guardCapture.__lastLog = t;
        }
      }
    };
    document.addEventListener('input', guardCapture, true);
    document.addEventListener('change', guardCapture, true);

    // When material select changes, extend the silence window for a brief period
    const installSelectHook = () => {
      const sel = selMaterial();
      if (!sel) return false;
      const bumpSilence = (reason, ms=220) => {
        const until = now() + ms;
        silenceUntil = Math.max(silenceUntil, until);
        // brief visual lock can further reduce jitter; keep very short
        const panel = findPanel();
        if (panel && !panel.__silence_css__) {
          panel.__silence_css__ = true;
          const css = document.createElement('style');
          css.textContent = `
            .__mat_silence__ * { pointer-events: none !important; }
          `;
          document.head.appendChild(css);
        }
        const panel = findPanel();
        if (panel) {
          panel.classList.add('__mat_silence__');
          setTimeout(() => panel.classList.remove('__mat_silence__'), ms);
        }
        // Debug log
        console.debug(LOG_PREFIX, `silence ${ms}ms (${reason})`);
      };

      sel.addEventListener('change', () => bumpSilence('select-change', 260));
      // Some orchestrators dispatch 'input' after programmatic sync; add tiny buffer
      sel.addEventListener('input', () => bumpSilence('select-input', 220));

      // Also watch for rapid programmatic value churn on key sliders/toggles;
      // when attributes mutate without user action, bump a short silence.
      const panel = findPanel();
      if (panel && !panel.__mo__) {
        const mo = new MutationObserver((list) => {
          // If we're already in a silence window we don't need to extend it too eagerly.
          if (now() < silenceUntil) return;
          for (const m of list) {
            if (m.type === 'attributes' && (m.attributeName === 'value' || m.attributeName === 'checked')) {
              if (isInsidePanel(m.target)) {
                // extend a tiny bit to absorb any synthetic 'input' the orchestrator might dispatch next
                silenceUntil = Math.max(silenceUntil, now() + 140);
                break;
              }
            }
          }
        });
        mo.observe(panel, { subtree: true, attributes: true, attributeFilter: ['value', 'checked'] });
        panel.__mo__ = mo;
      }
      return true;
    };

    // Retry until material select appears
    let tries = 0;
    const id = setInterval(() => {
      tries++;
      if (installSelectHook()) {
        clearInterval(id);
        console.log(LOG_PREFIX, "installed");
      } else if (tries > 50) {
        clearInterval(id);
        console.warn(LOG_PREFIX, "gave up (select not found)");
      }
    }, 120);
  } catch (e) {
    console.warn(LOG_PREFIX, "failed to install:", e);
  }
})();
