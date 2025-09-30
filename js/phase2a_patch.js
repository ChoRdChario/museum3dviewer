// js/phase2a_patch.js
// Phase2a: overlay, thumbnail grid, HEIC loader, pin interactions, ortho fixes
(function(){
  const log = (...a)=>console.log("[LMY:p2a]", ...a);

  // --- HEIC dynamic loader -------------------------------------------------
  async function ensureHeic2Any(){
    if (window.heic2any) return true;
    return new Promise((resolve)=>{
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/heic2any/dist/heic2any.min.js";
      s.onload = ()=>{ log("heic2any loaded"); resolve(true); };
      s.onerror = ()=>{ console.warn("[LMY:p2a] heic2any load failed"); resolve(false); };
      document.head.appendChild(s);
    });
  }
  window.__LMY_ensureHeic2Any = ensureHeic2Any;

  // --- Selected-caption overlay -------------------------------------------
  function getOverlayHost(){
    let host = document.getElementById("lmy_overlay");
    if (!host){
      host = document.createElement("div");
      host.id = "lmy_overlay";
      host.style.cssText = "position:absolute;right:12px;top:12px;z-index:20;max-width:30vw;max-height:80vh;overflow:auto;display:none";
      const view = document.querySelector("#view,.view,.viewport,canvas");
      const mount = (view && view.parentElement) || document.body;
      mount.appendChild(host);
    }
    return host;
  }
  function showOverlay({title, body, imgUrl}){
    const host = getOverlayHost();
    host.innerHTML = "";
    const card = document.createElement("div");
    card.className = "lmy-card";
    card.innerHTML = '<div class="lmy-ov-title">'+(title||"")+'</div>' +
                     '<div class="lmy-ov-body">'+((body||"").replace(/\n/g,"<br>"))+'</div>';
    if (imgUrl){
      const im = new Image();
      im.src = imgUrl;
      im.style.maxWidth = "100%";
      im.style.height = "auto";
      im.style.display = "block";
      im.style.marginTop = "8px";
      card.appendChild(im);
    }
    host.appendChild(card);
    host.style.display = "block";
  }
  function hideOverlay(){
    const h = document.getElementById("lmy_overlay");
    if (h) h.style.display = "none";
  }
  window.__LMY_overlay = { showOverlay, hideOverlay };

  // --- Same-folder image thumbnail grid -----------------------------------
  async function renderImageGrid(images){
    let host = document.getElementById("lmy_image_grid");
    if (!host){
      host = document.createElement("div");
      host.id = "lmy_image_grid";
      host.style.cssText = "display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px;max-height:240px;overflow:auto;border:1px solid #444;padding:8px;border-radius:8px";
      const capTab = document.getElementById("captionTab") || document.querySelector(".tab-caption,.tab-captions,#captions");
      (capTab || document.body).appendChild(host);
    }
    host.innerHTML = "";
    images.forEach(function(f){
      const cell = document.createElement("button");
      cell.className = "lmy-thumb";
      cell.title = f.name || "";
      cell.style.cssText = "background:#222;border:1px solid #555;border-radius:8px;padding:2px;cursor:pointer;display:flex;align-items:center;justify-content:center;aspect-ratio:1/1;overflow:hidden";
      const wrap = document.createElement("div");
      wrap.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center";
      const im = new Image();
      im.referrerPolicy = "no-referrer";
      im.decoding = "async";
      im.loading = "lazy";
      im.style.maxWidth = "100%"; im.style.maxHeight = "100%";
      im.src = f.thumbnailLink || "";
      wrap.appendChild(im);
      cell.appendChild(wrap);
      cell.onclick = function(){
        document.dispatchEvent(new CustomEvent("lmy:image-picked", { detail: f }));
        showOverlay({ title: f.name, body:"", imgUrl: (f.thumbnailLink||"") });
      };
      host.appendChild(cell);
    });
  }
  window.__LMY_renderImageGrid = renderImageGrid;

  // --- Ortho: wheel zoom & aspect resize ----------------------------------
  function installOrthoWheel(){
    if (window.__LMY_ORTHO_WHEEL_OK) return;
    window.__LMY_ORTHO_WHEEL_OK = true;
    window.addEventListener("wheel", function(e){
      try{
        const v = window.viewer || window.VIEWER || null;
        const cam = v && (v.cameraOrtho || v.ortho || v._cameraOrtho);
        if (cam && cam.isOrthographicCamera){
          e.preventDefault();
          const dz = (e.deltaY>0 ? 1.1 : 1/1.1);
          cam.zoom = Math.max(0.1, Math.min(128, cam.zoom * dz));
          cam.updateProjectionMatrix && cam.updateProjectionMatrix();
        }
      }catch(_){}
    }, { passive:false });
  }
  function installResizeFix(){
    if (window.__LMY_ORTHO_RESIZE_OK) return;
    window.__LMY_ORTHO_RESIZE_OK = true;
    window.addEventListener("resize", function(){
      try{
        const v = window.viewer || window.VIEWER || null;
        const cam = v && (v.cameraOrtho || v.ortho || v._cameraOrtho);
        const el = v && (v.canvas || (v.renderer && v.renderer.domElement) || document.querySelector("canvas"));
        if (cam && cam.isOrthographicCamera && el){
          const w = el.clientWidth || el.width || window.innerWidth;
          const h = el.clientHeight || el.height || window.innerHeight;
          const aspect = Math.max(0.0001, w / h);
          const s = (v.__orthoSize || 10);
          cam.left = -s * aspect;
          cam.right = s * aspect;
          cam.top = s;
          cam.bottom = -s;
          cam.updateProjectionMatrix && cam.updateProjectionMatrix();
        }
      }catch(_){}
    });
  }
  installOrthoWheel();
  installResizeFix();

  // --- Pins: click to select / Shift+click to add -------------------------
  function installPinHandlers(){
    if (window.__LMY_PINS_OK) return;
    window.__LMY_PINS_OK = true;
    const canvas = document.querySelector("canvas");
    if (!canvas) return;
    canvas.addEventListener("click", function(e){
      if (e.shiftKey){
        document.dispatchEvent(new CustomEvent("lmy:add-pin", { detail: { x:e.clientX, y:e.clientY } }));
      } else {
        document.dispatchEvent(new CustomEvent("lmy:pick-pin", { detail: { x:e.clientX, y:e.clientY } }));
      }
    });
  }
  installPinHandlers();

  // hint to app for leader-line visibility
  function selectPinUiOnly(caption){
    document.dispatchEvent(new CustomEvent("lmy:select-pin", { detail: caption }));
  }
  window.__LMY_selectPinUiOnly = selectPinUiOnly;

  // tiny API
  window.__LMY_phase2a = { showOverlay, hideOverlay, renderImageGrid, ensureHeic2Any };

  log("phase2a loaded");
})();
