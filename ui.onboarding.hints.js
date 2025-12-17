/* ui.onboarding.hints.js — v1.2
 * Purpose: Encourage first action (Sign in / Load) and guide Load via hover tip.
 * Scope: Edit + Share (read-only safe).
 */
(() => {
  const TAG = '[lm-onboard]';
  // v2: store per-mode keys so Share onboarding is not suppressed by Edit usage.
  const STORE_KEY = 'lm_onboard_v2';

  function getModeKeyPrefix() {
    try {
      if (typeof window.__lm_isShareMode === 'function' && window.__lm_isShareMode()) return 'share';
    } catch {}
    return 'edit';
  }

  function loadState() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveState(s) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch {}
  }
  const state = loadState();

  const modePrefix = getModeKeyPrefix();
  const keyOf = (k) => `${modePrefix}:${k}`;
  function markDone(k) { state[keyOf(k)] = true; saveState(state); }
  function isDone(k) { return !!state[keyOf(k)]; }

  function $(sel) { return document.querySelector(sel); }

  function applyPulse(el, key) {
    if (!el || isDone(key)) return;
    el.classList.add('lm-attn-pulse');
    // Remove pulse on first user click as minimum.
    el.addEventListener('click', () => {
      el.classList.remove('lm-attn-pulse');
      markDone(key);
      console.log(TAG, 'dismissed', key);
    }, { once: true });
  }

  function wireLoadTooltip(btn) {
    if (!btn) return;
    // Use native tooltip (title) so we don't need layout-tuning when copy changes.
    const tip = 'Googleドライブに保存したGLBモデルの共有リンクを入力してLoad';
    // Clean up any legacy custom tooltip attributes/classes.
    btn.removeAttribute('data-tip');
    btn.classList.remove('lm-has-tip');
    btn.setAttribute('title', tip);
  }

  function onDomReady() {
    const btnSignin = $('#auth-signin');
    const btnLoad = $('#btnGlb');

    // Always guide Load; it is a core entry point in both modes.
    applyPulse(btnLoad, 'load');
    wireLoadTooltip(btnLoad);

    // Sign-in prompt: only if the button exists (share/edit both have it).
    applyPulse(btnSignin, 'signin');

    // Stronger: if token is acquired by any flow, mark signin done.
    // Wrap __lm_getAccessToken when it becomes available (boot scripts may load after DOM).
    const tryWrapGetToken = () => {
      const w = window;
      if (typeof w.__lm_getAccessToken !== 'function') return false;
      if (w.__lm_getAccessToken.__lm_wrapped) return true;

      const orig = w.__lm_getAccessToken;
      const wrapped = async function(...args) {
        const t = await orig.apply(this, args);
        if (t) {
          if (!isDone('signin')) markDone('signin');
          const b = $('#auth-signin');
          if (b) b.classList.remove('lm-attn-pulse');
          console.log(TAG, 'signin detected via token');
        }
        return t;
      };
      wrapped.__lm_wrapped = true;
      w.__lm_getAccessToken = wrapped;
      return true;
    };

    if (!tryWrapGetToken()) {
      let n = 0;
      const itv = setInterval(() => {
        n++;
        if (tryWrapGetToken() || n > 24) clearInterval(itv); // ~6s max
      }, 250);
    }


    // If GLB load completes, mark load done and remove pulse.
    document.addEventListener('lm:glb-loaded', () => {
      if (!isDone('load')) {
        markDone('load');
        const b = $('#btnGlb');
        if (b) b.classList.remove('lm-attn-pulse');
        console.log(TAG, 'glb loaded; load hint cleared');
      }
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onDomReady, { once: true });
  } else {
    onDomReady();
  }
})();
