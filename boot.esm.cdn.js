/* ============================================================================
 * LociMyu GLB Loader Bridge (minimal)
 * File: boot.esm.cdn.js
 * Purpose: Focus ONLY on GLB loading from #glbUrl via #btnGlb (and Enter key).
 * Safe: Non-invasive. Does not touch auth, sheets, or material logic.
 * Version: v0.3 (2025-11-12)
 * ========================================================================== */

(() => {
  const TAG = "[LM-glb.min]";

  // idempotent wiring guards
  function markWired(el, key) {
    if (!el) return false;
    const k = "__lm_wired_" + key;
    if (el[k]) return true;
    el[k] = true;
    return false;
  }

  function getEls() {
    return {
      btn: document.querySelector("#btnGlb") || document.getElementById("btnGlb"),
      input: document.querySelector("#glbUrl") || document.getElementById("glbUrl"),
    };
  }

  function normalizeUrl(s) {
    if (!s) return "";
    const u = String(s).trim();
    // Accept data:, blob:, http(s) schemes; otherwise return as-is (viewer/event may know)
    if (/^(data:|blob:|https?:)/i.test(u)) return u;
    return u;
  }

  async function tryViewerLoad(url) {
    try {
      if (window.viewer && typeof window.viewer.loadModel === "function") {
        console.log(TAG, "viewer.loadModel(url) path");
        await window.viewer.loadModel(url);
        return true;
      }
    } catch (e) {
      console.warn(TAG, "viewer.loadModel threw", e);
    }
    return false;
  }

  function signalGlb(url) {
    try {
      console.log(TAG, "dispatch lm:glb-load", url);
      const ev = new CustomEvent("lm:glb-load", { detail: { url } });
      window.dispatchEvent(ev);
      return true;
    } catch (e) {
      console.warn(TAG, "dispatch failed", e);
      return false;
    }
  }

  function handleLoad(urlRaw) {
    const url = normalizeUrl(urlRaw);
    if (!url) {
      console.warn(TAG, "empty URL in #glbUrl");
      return;
    }
    // Prefer viewer API; fallback to signal
    tryViewerLoad(url).then((ok) => {
      if (!ok) signalGlb(url);
    });
  }

  function wireOnce() {
    const { btn, input } = getEls();
    if (!btn || !input) return false;

    if (!markWired(btn, "click")) {
      btn.addEventListener("click", () => handleLoad(input.value));
      console.log(TAG, "wired #btnGlb -> handleLoad(#glbUrl.value)");
    }

    if (!markWired(input, "enter")) {
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleLoad(input.value);
        }
      });
      console.log(TAG, "wired #glbUrl[Enter] -> handleLoad");
    }

    // small UX: paste/drop auto-trim
    if (!markWired(input, "blurtrim")) {
      input.addEventListener("blur", () => (input.value = String(input.value || "").trim()));
    }

    return true;
  }

  // Initial try
  const okInitial = wireOnce();
  if (!okInitial) console.log(TAG, "waiting DOM…");

  // Re-wire on DOM changes (non-invasive, avoids double binding)
  const mo = new MutationObserver(() => wireOnce());
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Optional: also react to a custom boot-ready event if your app fires one
  window.addEventListener("lm:boot-ready", () => wireOnce(), { passive: true });

  console.log(TAG, "ready");
})();
