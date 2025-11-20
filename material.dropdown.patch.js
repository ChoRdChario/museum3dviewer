{
type: uploaded file
fileName: material.dropdown.patch.js
fullContent:
/* material.dropdown.patch.js v3.6
 * Purpose: Populate #pm-material using viewerBridge.listMaterials()
 * ensures the 'value' attribute matches exactly what applyMaterialProps expects.
 */
(function(){
  const TAG = '[mat-dd v3.6]';
  
  // Helper: find canonical select element
  function locateSelect(){
    return document.getElementById('pm-material') 
        || document.getElementById('materialSelect')
        || document.querySelector('#pm-opacity select');
  }

  let isPopulated = false;

  async function populate(){
    if (isPopulated) return;
    const sel = locateSelect();
    const br = window.__lm_viewer_bridge || window.viewerBridge;
    
    if (!sel) return; // UI not ready
    if (!br || typeof br.listMaterials !== 'function') return; // Viewer not ready

    // Get correct keys from viewer (e.g. "glb::0::MaterialName")
    const list = br.listMaterials(); 
    if (!list || list.length === 0) {
      // Retry briefly if list is empty (scene might be loading)
      return; 
    }

    // Generate Options
    const currentVal = sel.value;
    const opts = ['<option value="">— Select material —</option>'];
    
    list.forEach(m => {
      // name: display text, materialKey: internal ID
      opts.push(`<option value="${m.materialKey}">${m.name}</option>`);
    });

    sel.innerHTML = opts.join('');
    
    // Restore selection if possible
    if (currentVal) {
      // Try exact match
      if (list.some(m => m.materialKey === currentVal)) {
        sel.value = currentVal;
      } 
      // Fallback: Try name match (if previous UI used simple names)
      else {
        const found = list.find(m => m.name === currentVal);
        if (found) sel.value = found.materialKey;
      }
    }

    isPopulated = true;
    console.log(TAG, 'populated from bridge', list.length, 'materials');
    sel.dispatchEvent(new Event('lm:mat-dd-populated', {bubbles:true}));
  }

  function arm(){
    // Try immediately
    populate();

    // Retry on events
    window.addEventListener('lm:viewer-bridge-ready', populate);
    window.addEventListener('lm:scene-ready', populate);
    window.addEventListener('lm:glb-loaded', () => {
      isPopulated = false; // Reset on new GLB
      setTimeout(populate, 500);
    });

    // Polling fallback (stops once populated)
    let tries = 0;
    const iv = setInterval(() => {
      if (isPopulated || tries > 20) clearInterval(iv);
      populate();
      tries++;
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arm, {once:true});
  } else {
    arm();
  }
})();
}