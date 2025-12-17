import './glb.url.prefill.js';
import './edit.sharelink.ui.js';
import './ui.onboarding.hints.js';

// LociMyu - app.edit.entry.js (generated from original index.html scripts)
// Loads the original script chain in the same order, preserving module/classic script types.
// This keeps Edit mode behavior identical while enabling Share mode to load a different safe set.

const MANIFEST = [
  {
    "kind": "inline",
    "code": "\n  (function(){\n    try {\n      var url = './content.js';\n      fetch(url, {method:'HEAD'}).then(function(r){\n        if (r && r.ok) {\n          var s = document.createElement('script');\n          s.src = url; s.defer = true;\n          s.onload = function(){ console.log('[VSC] Content script initialized (optional)'); };\n          document.head.appendChild(s);\n        } else {\n          console.log('[VSC] content.js not present (skipped)');\n        }\n      }).catch(function(){ console.log('[VSC] content.js check skipped'); });\n    } catch(e){\n      console.log('[VSC] content.js loader error', e);\n    }\n  })();\n  ",
    "type": null,
    "id": "lm-optional-contentjs"
  },
  {
    "kind": "inline",
    "code": "\n    (function(){\n      const tabs = document.querySelectorAll('[role=\"tab\"]');\n      const panes = document.querySelectorAll('.pane');\n      tabs.forEach(t => t.addEventListener('click', () => {\n        tabs.forEach(x => x.setAttribute('aria-selected', String(x===t)));\n        panes.forEach(p => p.dataset.active = String(p.dataset.pane===t.dataset.tab));\n      }));\n    })();\n  ",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./mode.ctx.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./init.ready.gate.js",
    "type": "module",
    "id": null
  },

  {
    "kind": "external",
    "src": "./boot.esm.cdn.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./sheet.gid.map.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "sheet-rename.module.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./sheet.ctx.bridge.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./viewer.bridge.module.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./caption.sheet.selector.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./materials.sheet.bridge.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.orchestrator.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./views.ui.controller.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "inline",
    "code": "\n  (() => {\n    const TAG='[lm-dx v4.3]'; const log=(...a)=>console.log(TAG,...a), warn=(...a)=>console.warn(TAG,...a);\n    const doc = document;\n    const right = doc.querySelector('#right, aside, .right, .sidebar') || doc.body;\n\n    function detoxClickable(target){\n      if (!target) return {disabled:0,target:null};\n      const r = target.getBoundingClientRect();\n      const p = {x: r.left + r.width*0.5, y: r.top + Math.min(16,r.height/2)};\n      const chain = doc.elementsFromPoint(p.x, p.y);\n      const idx = chain.indexOf(target);\n      const blockers = (idx===-1?chain:chain.slice(0,idx)).filter(e=>{\n        const cs=getComputedStyle(e), pos=cs.position;\n        const fixedLike = pos==='fixed'||pos==='absolute'||pos==='sticky';\n        return fixedLike && cs.pointerEvents!=='none' && right.contains(e);\n      });\n      blockers.forEach(e=>{ e.dataset.__pe_before=getComputedStyle(e).pointerEvents; e.style.pointerEvents='none'; e.classList.add('lm-pe-none'); });\n      target.style.pointerEvents='auto'; target.disabled=false;\n      log('detoxClickable',{disabled:blockers.length,target});\n      return {disabled:blockers.length,target};\n    }\n    detoxClickable(doc.getElementById('glbUrl'));\n    detoxClickable(doc.getElementById('auth-signin'));\n    detoxClickable(doc.getElementById('btnGlb'));\n\n    function findMaterialTabBtn() {\n      const idBtn = doc.getElementById('tab-material');\n      if (idBtn) return idBtn;\n      const btns = [...right.querySelectorAll('button,[role=\"tab\"],.tab,nav button,header button')];\n      const m = btns.find(b => (b.textContent||'').trim().toLowerCase() === 'material');\n      return m || null;\n    }\n    const materialTabBtn = findMaterialTabBtn();\n    function isMaterialActive() {\n      const b = materialTabBtn;\n      if (!b) return true;\n      const cs = b.getAttribute('aria-selected');\n      if (cs) return cs === 'true';\n      return b.classList.contains('active') || b.classList.contains('selected');\n    }\n\n    function visible(el){ try{ return !!el && el.offsetParent !== null; } catch(_){ return false; } }\n    const tabBar = right.querySelector('[role=\"tablist\"], .tabs, nav, header') || right;\n    const candidates = [\n      right.querySelector('#panel-material, [role=\"tabpanel\"][data-tab=\"material\"], [data-panel=\"material\"]'),\n      ...[...right.querySelectorAll('section,.card,.panel,.group')]\n        .filter(c => {\n          const r=c.getBoundingClientRect?.(); if(!r) return false;\n          if (tabBar && r.top < (tabBar.getBoundingClientRect?.().bottom||0)) return false;\n          const t=(c.textContent||'').toLowerCase();\n          return /per-?material/.test(t) || /opacity/.test(t) || /chroma key|double-?sided|unlit/.test(t);\n        })\n    ].filter(Boolean);\n    let panel = candidates.find(visible) || candidates[0] || null;\n\n    if (!panel && tabBar){\n      panel = doc.createElement('section');\n      panel.id = 'panel-material';\n      panel.className = 'lm-panel-material card';\n      panel.style.marginTop = '8px';\n      const style = doc.createElement('style');\n      style.textContent = `#panel-material { display: ${isMaterialActive() ? 'block' : 'none'}; }`;\n      doc.head.appendChild(style);\n      tabBar.insertAdjacentElement('afterend', panel);\n      log('synthesized panel');\n    }\n    if (!panel){ warn('material panel/card not found'); return; }\n\n    function ensureAnchors(dst){\n      let sel = dst.querySelector('#materialSelect');\n      if (!sel) { sel = doc.createElement('select'); sel.id='materialSelect'; sel.style.width='100%'; dst.appendChild(sel); }\n      let rng = dst.querySelector('#opacityRange');\n      if (!rng) { rng = doc.createElement('input'); rng.type='range'; rng.id='opacityRange'; rng.min='0'; rng.max='1'; rng.step='0.01'; rng.value='1.0'; rng.style.width='100%'; dst.appendChild(rng); }\n      return {sel,rng};\n    }\n    const tabBtn = doc.getElementById('tab-material');\n    if (tabBtn) tabBtn.querySelectorAll('#materialSelect,#opacityRange').forEach(n=>n.remove());\n\n    const {sel, rng} = ensureAnchors(panel);\n    ['materialSelect','opacityRange'].forEach(id=>{ const n=doc.getElementById(id); if(n && !panel.contains(n)) panel.appendChild(n); });\n    log('material controls anchored in panel', panel);\n    window.dispatchEvent(new Event('lm:mat-ui-ready',{bubbles:true}));\n  })();\n  ",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.dropdown.patch.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.runtime.patch.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./glb.load.signal.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.dropdown.patch.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./glb.load.signal.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.dropdown.patch.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.id.unify.v1.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.dropdown.sync.v1.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./material.state.local.v1.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "materials.sheet.persist.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./auto.apply.soft.patch.js",
    "type": null,
    "id": null
  },
  {
    "kind": "inline",
    "code": "\n  (function(){\n    const files = [\n      './caption.ui.controller.js',\n      './caption.sheet.bridge.js',\n      './caption.images.loader.js',\n      './pin.runtime.bridge.js'\n    ];\n    files.forEach(f=>{\n      fetch(f,{method:'HEAD'}).then(r=>{\n        if(r && r.ok){\n          const s=document.createElement('script');\n          s.type = f.endsWith('.js') ? 'module' : 'text/javascript';\n          s.src=f;\n          document.body.appendChild(s);\n          console.log('[caption] loaded', f);\n        } else {\n          console.log('[caption] skipped (not present)', f);\n        }\n      }).catch(()=>console.log('[caption] check skipped', f));\n    });\n  })();\n  ",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./content.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./glb.btn.bridge.v3.js",
    "type": "module",
    "id": null
  },
  {
    "kind": "external",
    "src": "./viewer.bridge.autobind.js",
    "type": null,
    "id": null
  },
  {
    "kind": "external",
    "src": "./pin.runtime.bridge.js",
    "type": null,
    "id": null
  }
];

function markLoaded(src) {
  try { (window.__LM_DIAG?.loaded || (window.__LM_DIAG.loaded=[])).push(src); } catch(_e) {}
}

function appendInline(code, attrs={}) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    if (attrs.id) s.id = attrs.id;
    if (attrs.type) s.type = attrs.type;
    s.textContent = code || '';
    (document.body || document.documentElement).appendChild(s);
    resolve();
  });
}

function appendExternal(src, attrs={}) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    if (attrs.id) s.id = attrs.id;
    if (attrs.type) s.type = attrs.type;
    // Important: preserve execution order for classic scripts
    if (!attrs.type || attrs.type !== 'module') s.async = false;
    s.src = src;

    s.onload = () => resolve();
    s.onerror = (e) => reject(new Error('Failed to load script: ' + src));
    (document.body || document.documentElement).appendChild(s);
  });
}

async function run() {
  console.log('[lm-entry] Edit entry starting…');
  for (const item of MANIFEST) {
    if (!item) continue;
    if (item.kind === 'external') {
      markLoaded(item.src);
      await appendExternal(item.src, { type: item.type || undefined, id: item.id || undefined });
    } else if (item.kind === 'inline') {
      // Inline scripts are executed immediately on insertion
      const tag = item.id ? ('inline#' + item.id) : 'inline';
      markLoaded(tag);
      await appendInline(item.code || '', { type: item.type || undefined, id: item.id || undefined });
    }
  }
  console.log('[lm-entry] Edit entry ready.');
}

run().catch(err => {
  console.error('[lm-entry] Edit entry failed', err);
});