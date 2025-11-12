
// [glb-id-capture v1.0] Set __LM_CURRENT_GLB_ID before GLB load to satisfy save.locator.js
(function(){
  console.log('[glb-id-capture v1.0] armed');

  function extractDriveFileId(s) {
    if (!s) return null;
    // /file/d/<id>/
    let m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    // id=<id> or open?id=<id>
    m = s.match(/(?:\?|&|#)id=([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    // uc?export=download&id=<id>
    m = s.match(/export=download[^#?]*[?&]id=([a-zA-Z0-9_-]{20,})/);
    if (m) return m[1];
    // If the string itself looks like an ID, accept it
    m = s.match(/^([a-zA-Z0-9_-]{20,})$/);
    if (m) return m[1];
    return null;
  }

  function setIdFromInput() {
    const input = document.querySelector('#glbUrl');
    const raw = input ? String(input.value || '') : '';
    const id = extractDriveFileId(raw);
    if (id) {
      window.__LM_CURRENT_GLB_ID = id;
      console.log('[glb-id-capture] __LM_CURRENT_GLB_ID =', id);
    } else {
      // If user pasted a share URL that requires conversion, still record raw for debugging
      console.warn('[glb-id-capture] could not parse fileId from', raw);
    }
  }

  // Install a capture-phase click listener so it runs before bubble listeners
  function arm() {
    const btn = document.querySelector('#btnGlb');
    if (!btn) return false;
    btn.addEventListener('click', function onClickCapture(evt){
      try { setIdFromInput(); } catch (e) { console.warn('[glb-id-capture] setId error', e); }
    }, true); // capture = true
    // Keep input in sync as user types/pastes
    const input = document.querySelector('#glbUrl');
    if (input) {
      input.addEventListener('change', setIdFromInput, { passive: true });
      input.addEventListener('blur', setIdFromInput, { passive: true });
      input.addEventListener('paste', () => setTimeout(setIdFromInput, 0), { passive: true });
    }
    return true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm, { once: true });
  } else {
    arm();
  }
})();
