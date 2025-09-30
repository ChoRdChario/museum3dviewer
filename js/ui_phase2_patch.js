// UI Phase2 patch: vertical captions, overlay, camera remap (rebinding), thumbnails, HEIC robust
import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';

const $ = (id)=> document.getElementById(id);

function log(...a){ try{ window.__LMY?.log(a.join(' ')); }catch(_){ console.log('[LMY]', ...a); } }

// 1) Enforce vertical layout (in case CSS not present)
(function(){
  const pane = document.querySelector('.caption-pane');
  if(pane){ pane.classList.add('vertical'); }
})();

// 2) Selected caption overlay in viewer
(function(){
  const overlay = document.getElementById('viewerOverlay');
  if(!overlay){
    // create if missing
    const vc = document.getElementById('viewerContainer') || document.getElementById('viewerPane');
    if(vc){
      const div = document.createElement('div');
      div.id = 'viewerOverlay';
      div.innerHTML = '<div id="ovrImageWrap"></div><div id="ovrTitle" style="font-weight:700;margin-bottom:4px"></div><div id="ovrBody" style="white-space:pre-wrap"></div>';
      vc.appendChild(div);
    }
  }
  // Hook caption selection changes
  const list = document.getElementById('captionList');
  if(list){
    list.addEventListener('click', (e)=>{
      const item = e.target.closest('[data-cap-id]');
      if(!item) return;
      const id = item.getAttribute('data-cap-id');
      // attempt to read from global state (main.js likely holds current captions)
      try{
        const cap = (window.captions||[]).find(c=> String(c.id)===String(id));
        if(cap){
          showOverlay(cap);
          setActivePin(id);
        }
      }catch(_){ /* noop */}
    });
  }

  async function showOverlay(cap){
    const overlay = document.getElementById('viewerOverlay');
    if(!overlay) return;
    const imgWrap = document.getElementById('ovrImageWrap');
    const title = document.getElementById('ovrTitle');
    const body = document.getElementById('ovrBody');
    title.textContent = cap.title || '';
    body.textContent  = cap.body || '';
    imgWrap.innerHTML = '';
    if(cap.imageId && window.drive){
      try{
        const meta = await window.drive.getFileMeta(cap.imageId);
        const buf = await window.drive.downloadFile(cap.imageId);
        const blob = new Blob([buf], { type: meta.mimeType || 'image/jpeg' });
        const url = URL.createObjectURL(blob);
        const img = new Image(); img.src = url;
        imgWrap.appendChild(img);
      }catch(err){ log('overlay img failed', err && err.message); }
    }
    overlay.style.display = 'block';
  }

  // Only draw connector for the active caption (best-effort hook)
  function setActivePin(id){
    try{
      if(window.viewer && typeof window.viewer.setActiveCaptionId === 'function'){
        window.viewer.setActiveCaptionId(id);
      }else{
        // fallback: custom event; viewer.js側で対応可能なら拾ってもらう
        window.dispatchEvent(new CustomEvent('lmy:set-active-caption', { detail:{ id } }));
      }
    }catch(_){}
  }
})();

// 3) Thumbnails under image select & HEIC convert robustness
(function(){
  const grid = document.getElementById('capThumbGrid');
  const sel  = document.getElementById('capImageSelect');
  if(!grid || !sel) return;

  async function refreshThumbs(){
    grid.innerHTML = '';
    for(const opt of sel.options){
      const id = opt.value; if(!id) continue;
      try{
        const meta = await window.drive.getFileMeta(id);
        const buf  = await window.drive.downloadFile(id);
        let blob = new Blob([buf], { type: meta.mimeType || 'application/octet-stream' });
        const isHeic = /image\/heic|image\/heif|\.heic$|\.heif$/i.test(meta.mimeType||'') || /\.hei[cf]$/i.test(meta.name||'');
        if(isHeic){
          const fn = (window.heic2any && (window.heic2any.default || window.heic2any)) || null;
          if(fn){
            try{
              blob = await fn({ blob, toType: 'image/jpeg', quality: 0.9 });
            }catch(err){
              log('heic2any convert failed (thumb):', err && err.message);
              // show placeholder thumb
              const div = document.createElement('div'); div.className='thumb'; div.textContent='HEIC 変換失敗';
              grid.appendChild(div); continue;
            }
          }
        }
        const url = URL.createObjectURL(blob);
        const div = document.createElement('div'); div.className='thumb'; div.dataset.id = id;
        div.innerHTML = `<img src="${url}" alt="">`;
        div.onclick = ()=>{ sel.value = id; sel.dispatchEvent(new Event('change')); };
        grid.appendChild(div);
      }catch(err){ log('thumb err', err && err.message); }
    }
  }

  sel.addEventListener('change', refreshThumbs);
  // initial
  setTimeout(refreshThumbs, 1000);
})();

// 4) Camera preset remap by rebinding button handlers (in case prototype patch didn't hook)
(function(){
  const map = { front:'right', back:'left', left:'back', right:'front', top:'top', bottom:'bottom' };
  document.querySelectorAll('.camPreset').forEach(btn=>{
    btn.addEventListener('click', (e)=>{
      e.preventDefault();
      const v = btn.dataset.v;
      const mapped = map[v] || v;
      if(window.viewer && typeof window.viewer.setCameraPreset === 'function'){
        window.viewer.setCameraPreset(mapped);
      }
    }, true);
  });
})();

// 5) Ortho zoom ensure
(function(){
  const ortho = document.getElementById('orthoToggle');
  if(ortho){
    ortho.addEventListener('change', ()=>{
      try{
        const controls = window.viewer && (window.viewer.controls || window.viewer.orbit || window.viewer.orbitControls);
        if(controls){ controls.enableZoom = true; controls.zoomToCursor = true; controls.update && controls.update(); }
      }catch(_){}
    });
  }
})();

// 6) Per-material settings: populate material list from scene & apply per selection
(function(){
  const sel = document.getElementById('matSelect');
  if(!sel) return;
  function collectMaterials(){
    const v = window.viewer;
    if(!v || !(v.scene || v.root)) return [];
    const scene = v.scene || v.root;
    const mats = new Map(); // key: uuid -> {mat, name}
    scene.traverse(obj=>{
      if(obj.isMesh && obj.material){
        const arr = Array.isArray(obj.material) ? obj.material : [obj.material];
        for(const m of arr){
          if(!m || !m.uuid) continue;
          if(!mats.has(m.uuid)){
            mats.set(m.uuid, { mat:m, name: m.name || obj.name || m.uuid.slice(0,8) });
          }
        }
      }
    });
    return [...mats.values()];
  }
  function fill(){
    sel.innerHTML = '';
    const items = collectMaterials();
    for(const it of items){
      const o = document.createElement('option');
      o.value = it.mat.uuid; o.textContent = it.name;
      sel.appendChild(o);
    }
  }
  window.addEventListener('lmy:model-loaded', fill);
  setTimeout(fill, 1200);

  function currentMat(){
    const id = sel.value; if(!id) return null;
    const items = collectMaterials();
    const found = items.find(x=> x.mat.uuid===id);
    return found && found.mat;
  }

  function applyToMat(config){
    const m = currentMat(); if(!m) return;
    // baseline
    m.side = config.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    m.transparent = (config.opacity<1.0) || config.whiteKey || config.blackKey;
    m.opacity = config.opacity;
    m.depthWrite = !m.transparent;
    // shader injection for white/black key
    const cfg = { whiteKey:config.whiteKey, whiteThr:config.whiteThr, blackKey:config.blackKey, blackThr:config.blackThr, opacity:config.opacity };
    // simple injection using onBeforeCompile
    if(!m.userData) m.userData = {};
    if(!config.whiteKey && !config.blackKey){
      if(m.userData.__lmy_restore){
        try{ m.onBeforeCompile = m.userData.__lmy_restore; }catch(_){}
      }
      m.needsUpdate = true; return;
    }
    if(!m.userData.__lmy_restore) m.userData.__lmy_restore = m.onBeforeCompile;
    m.onBeforeCompile = function(shader){
      shader.uniforms.LMY_WHITE_THR = { value: cfg.whiteThr ?? 0.95 };
      shader.uniforms.LMY_BLACK_THR = { value: cfg.blackThr ?? 0.05 };
      shader.uniforms.LMY_USE_WHITE = { value: !!cfg.whiteKey };
      shader.uniforms.LMY_USE_BLACK = { value: !!cfg.blackKey };
      shader.fragmentShader = shader.fragmentShader.replace('void main() {', `uniform float LMY_WHITE_THR;uniform float LMY_BLACK_THR;uniform bool LMY_USE_WHITE;uniform bool LMY_USE_BLACK;\nvoid main(){`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
        vec4 sampledDiffuseColor = texture2D( map, vMapUv );
        diffuseColor *= sampledDiffuseColor;
        float keyAlpha = 1.0;
        if(LMY_USE_WHITE){
          float distW = distance(sampledDiffuseColor.rgb, vec3(1.0));
          float aW = smoothstep(LMY_WHITE_THR, LMY_WHITE_THR - 0.1, 1.0 - distW);
          keyAlpha = min(keyAlpha, aW);
        }
        if(LMY_USE_BLACK){
          float distB = distance(sampledDiffuseColor.rgb, vec3(0.0));
          float aB = smoothstep(LMY_BLACK_THR, LMY_BLACK_THR - 0.1, 1.0 - distB);
          keyAlpha = min(keyAlpha, aB);
        }
        diffuseColor.a *= keyAlpha;
      #endif`);
    };
    m.needsUpdate = true;
  }

  const cfg = {
    get opacity(){ return parseFloat(document.getElementById('matOpacity')?.value ?? '1'); },
    get doubleSided(){ return !!document.getElementById('matDoubleSided')?.checked; },
    get unlit(){ return !!document.getElementById('matUnlit')?.checked; },
    get whiteKey(){ return !!document.getElementById('matWhiteKey')?.checked; },
    get whiteThr(){ return parseFloat(document.getElementById('matWhiteKeyThr')?.value ?? '0.95'); },
    get blackKey(){ return !!document.getElementById('matBlackKey')?.checked; },
    get blackThr(){ return parseFloat(document.getElementById('matBlackKeyThr')?.value ?? '0.05'); },
  };
  ['matOpacity','matDoubleSided','matUnlit','matWhiteKey','matWhiteKeyThr','matBlackKey','matBlackKeyThr','matSelect']
    .forEach(id=>{ const el = document.getElementById(id); if(el){ el.addEventListener('input', ()=> applyToMat(cfg)); el.addEventListener('change', ()=> applyToMat(cfg)); } });
})();

// 7) Shift+click to add pin
(function(){
  const viewerEl = document.getElementById('viewer');
  if(!viewerEl) return;
  viewerEl.addEventListener('click', (e)=>{
    if(!e.shiftKey) return;
    try{
      if(window.viewer && typeof window.viewer.addPinAtScreen === 'function'){
        const rect = viewerEl.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const y = (e.clientY - rect.top) / rect.height;
        window.viewer.addPinAtScreen(x,y);
      }else{
        window.dispatchEvent(new CustomEvent('lmy:add-pin-screen', { detail:{ clientX:e.clientX, clientY:e.clientY } }));
      }
    }catch(err){ log('shift+click add pin failed', err && err.message); }
  }, true);
})();

console.log('[LociMyu] UI Phase2 patch loaded');
