// material_panel.js — self-initializing material controls & patches
// This module auto-initializes when it detects `app.viewer` and the Material tab DOM.
// Expected DOM IDs:
//   #matTarget, #btnUnlit, #btnDoubleSide, #matOpacity, #whiteAlpha
(function(){
  function log(...a){ console.log('[material]', ...a); }
  function getApp(){
    return window.__LMY_APP || window.app || window.viewerApp || null;
  }
  function once(el, ev, fn){ const h=(e)=>{ el.removeEventListener(ev,h); fn(e);}; el.addEventListener(ev,h); }

  function collectMaterials(app){
    const map = new Map(); // uuid -> {mat,name,users:Set<Mesh>}
    app.viewer.scene.traverse(obj=>{
      if (!obj.isMesh) return;
      const add=(m)=>{
        if (!m) return;
        const key=m.uuid;
        if (!map.has(key)) map.set(key,{mat:m,name:(m.name||'(no name)'),users:new Set()});
        map.get(key).users.add(obj);
      };
      if (Array.isArray(obj.material)) obj.material.forEach(add); else add(obj.material);
    });
    return map;
  }

  function ensureShaderPatch(app, whiteAlphaValue){
    const THREE = app.viewer.THREE;
    const KEY = '__lmy_patched';
    const apply = (mat)=>{
      if (!mat || mat[KEY]) return;
      mat.onBeforeCompile = (shader)=>{
        // add uniform
        shader.uniforms.uWhiteAlpha = { value: (typeof whiteAlphaValue==='number' ? whiteAlphaValue : 1.0) };
        // compute whiteness (simple max component)
        shader.fragmentShader = shader.fragmentShader
          .replace('void main() {', 'uniform float uWhiteAlpha;\nvoid main() {')
          .replace(/gl_FragColor\s*=\s*vec4\(([^;]+)\);\s*$/m, (m, inner)=>{
            // keep original result in c
            return `vec4 c = vec4(${inner});
  float w = max(c.r, max(c.g, c.b));
  float cut = smoothstep(uWhiteAlpha, 1.0, w);
  c.a *= (1.0 - cut);
  gl_FragColor = c;`;
          });
      };
      mat[KEY]=true;
      mat.needsUpdate=true;
    };
    // patch all current materials
    const set = new Set();
    app.viewer.scene.traverse(obj=>{
      if (!obj.isMesh) return;
      const mats = Array.isArray(obj.material)? obj.material : [obj.material];
      mats.forEach(m=>{ if (m && !set.has(m)) { set.add(m); apply(m);} });
    });
  }

  function setup(){
    const app = getApp();
    if (!app || !app.viewer) return false;
    const sel = document.getElementById('matTarget');
    const btnUnlit = document.getElementById('btnUnlit');
    const btnDouble = document.getElementById('btnDoubleSide');
    const rngOpacity = document.getElementById('matOpacity');
    const rngWhite = document.getElementById('whiteAlpha') || document.getElementById('whiteAlphaRange');
    if (!sel || !btnUnlit || !btnDouble) return false;

    // state
    const ALL='*';
    let target = new Set([ALL]);
    let materialMap = new Map();
    const THREE = app.viewer.THREE;

    function rebuildList(){
      materialMap = collectMaterials(app);
      sel.innerHTML='';
      const optAll=document.createElement('option'); optAll.value=ALL; optAll.textContent='(All)';
      sel.appendChild(optAll);
      let i=0;
      for (const [uuid, rec] of materialMap){
        const opt=document.createElement('option');
        opt.value=uuid;
        opt.textContent = `${i}: ${rec.name || '(no name)'}`;
        sel.appendChild(opt); i++;
      }
      sel.value=ALL; target=new Set([ALL]);
    }

    function forEachTargetMesh(fn){
      const applyAll = target.has(ALL);
      app.viewer.scene.traverse(obj=>{
        if (!obj.isMesh) return;
        const mats = Array.isArray(obj.material)? obj.material : [obj.material];
        const hit = applyAll || mats.some(m=> m && target.has(m.uuid));
        if (!hit) return;
        fn(obj);
      });
    }

    function isUnlit(mesh){ return !!mesh.userData.__origMaterial; }
    function toUnlit(mesh){
      if (isUnlit(mesh)) return;
      const orig = mesh.material;
      const mk = (m)=>{
        const b = new THREE.MeshBasicMaterial();
        b.name = (m && m.name) ? (m.name + ' (unlit)') : 'unlit';
        if (m && m.color) b.color.copy(m.color);
        b.map = m && m.map || null;
        b.opacity = (m && m.opacity!=null)? m.opacity : 1;
        b.transparent = (m && m.transparent) || b.opacity<1;
        b.side = m && m.side || THREE.FrontSide;
        b.depthWrite = m && m.depthWrite;
        b.depthTest = m && m.depthTest;
        b.alphaMap = m && m.alphaMap || null;
        b.toneMapped = false;
        return b;
      };
      mesh.userData.__origMaterial = orig;
      mesh.material = Array.isArray(orig) ? orig.map(mk) : mk(orig);
      if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true));
      else mesh.material.needsUpdate=true;
    }
    function fromUnlit(mesh){
      if (!isUnlit(mesh)) return;
      mesh.material = mesh.userData.__origMaterial;
      delete mesh.userData.__origMaterial;
      if (Array.isArray(mesh.material)) mesh.material.forEach(m=> m && (m.needsUpdate=true));
      else if (mesh.material) mesh.material.needsUpdate=true;
    }

    function refreshStates(){
      let anyUnlit=false, anyDouble=false;
      forEachTargetMesh(mesh=>{
        if (isUnlit(mesh)) anyUnlit=true;
        const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
        mats.forEach(m=>{ if (m && m.side===THREE.DoubleSide) anyDouble=true; });
      });
      btnUnlit.textContent = `Unlit: ${anyUnlit?'on':'off'}`;
      btnDouble.textContent = `DoubleSide: ${anyDouble?'on':'off'}`;
    }

    // wire UI
    sel.addEventListener('change', ()=>{
      target = (sel.value===ALL) ? new Set([ALL]) : new Set([sel.value]);
      refreshStates();
    });
    btnUnlit.addEventListener('click', ()=>{
      let any=false; forEachTargetMesh(mesh=>{ if(isUnlit(mesh)) any=true; });
      if (any){ forEachTargetMesh(fromUnlit); } else { forEachTargetMesh(toUnlit); }
      rebuildList(); refreshStates();
    });
    btnDouble.addEventListener('click', ()=>{
      let toDouble=true;
      forEachTargetMesh(mesh=>{
        const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
        for (const m of mats){ if (m && m.side===THREE.DoubleSide){ toDouble=false; break; } }
      });
      forEachTargetMesh(mesh=>{
        const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
        mats.forEach(m=>{ if (!m) return; m.side = toDouble? THREE.DoubleSide : THREE.FrontSide; m.needsUpdate=true; });
      });
      refreshStates();
    });
    if (rngOpacity){
      rngOpacity.addEventListener('input', ()=>{
        const v=parseFloat(rngOpacity.value);
        forEachTargetMesh(mesh=>{
          const mats = Array.isArray(mesh.material)? mesh.material : [mesh.material];
          mats.forEach(m=>{ if(!m) return; m.opacity=v; m.transparent=v<0.999; m.needsUpdate=true; });
        });
      });
    }

    // White->Alpha patch + slider
    let whiteAlpha = rngWhite ? parseFloat(rngWhite.value) : 1.0;
    ensureShaderPatch(app, whiteAlpha);
    if (rngWhite){
      rngWhite.addEventListener('input', ()=>{
        whiteAlpha = parseFloat(rngWhite.value);
        // update all materials with patched uniform
        app.viewer.scene.traverse(obj=>{
          if (!obj.isMesh) return;
          const mats = Array.isArray(obj.material)? obj.material : [obj.material];
          mats.forEach(m=>{
            if (m && m.userData) {
              // uniforms live in program; we can force recompile to propagate new value
              m.needsUpdate = true;
            }
          });
        });
        // After recompile, set new uniform through onBeforeCompile path
        ensureShaderPatch(app, whiteAlpha);
      });
    }

    // Rebuild on model-loaded
    window.addEventListener('lmy:model-loaded', ()=>{
      rebuildList(); refreshStates(); ensureShaderPatch(app, whiteAlpha);
    });

    // initial
    rebuildList(); refreshStates();
    log('panel wired');
    return true;
  }

  function boot(){
    if (setup()) return;
    // try again after DOM/app becomes ready
    let tries=0;
    const timer = setInterval(()=>{
      tries++; if (setup()){ clearInterval(timer); }
      else if (tries>50){ clearInterval(timer); }
    }, 120);
  }

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
