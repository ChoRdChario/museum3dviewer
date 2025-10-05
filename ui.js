import { ViewerApp } from './viewer.js';

// --- App singletons
const app = { viewer:null };

// Tabs
function setupTabs(){
  const tabs = [
    {btn:'tab-caption', sec:'sec-caption'},
    {btn:'tab-material', sec:'sec-material'},
    {btn:'tab-view', sec:'sec-view'},
  ];
  for(const t of tabs){
    document.getElementById(t.btn).onclick = ()=>{
      for(const s of tabs){
        document.getElementById(s.btn).classList.toggle('active', s.btn===t.btn);
        document.getElementById(s.sec).classList.toggle('active', s.btn===t.btn);
      }
    };
  }
}

// Normalize Drive url or id to downloadable url
function normalizeDriveUrl(input){
  const s = (input||'').trim();
  if(!s) return null;
  // direct id
  if(/^[0-9A-Za-z_-]{20,}$/.test(s)) return `https://drive.google.com/uc?export=download&id=${s}`;
  // file url
  const m = s.match(/drive\.google\.com\/file\/d\/([0-9A-Za-z_-]+)/);
  if(m) return `https://drive.google.com/uc?export=download&id=${m[1]}`;
  return s; // fallback
}

// Guard: reject HTML responses
async function fetchArrayBufferGuard(url){
  const res = await fetch(url, {mode:'cors'});
  const ct = res.headers.get('content-type')||'';
  if(!res.ok) throw new Error(`HTTP ${res.status}`);
  if(ct.includes('text/html')) throw new Error('Got HTML not GLB/GLTF (Drive preview?)');
  return await res.arrayBuffer();
}

export function setupUI(){
  // viewer
  app.viewer = new ViewerApp(document.getElementById('stage'));

  // caption tab
  document.getElementById('demo-btn').onclick = ()=>{
    // nothing: demo cube already shown
  };
  const input = document.getElementById('drive-input');
  document.getElementById('btn-load-glb').onclick = async ()=>{
    try{
      const url = normalizeDriveUrl(input.value);
      if(!url) return;
      const ab = await fetchArrayBufferGuard(url);
      await app.viewer.loadGLBFromArrayBuffer(ab);
    }catch(err){
      console.error('[ui] load glb failed', err);
      alert('Failed to load GLB: ' + err.message);
    }
  };

  // material tab (simple demo controls, apply to all visible meshes when available)
  const op = document.getElementById('mat-opacity');
  const unlitBtn = document.getElementById('mat-unlit');
  const dsBtn = document.getElementById('mat-doubleside');

  function eachMaterials(fn){
    if(!app.viewer?.gltfRoot) return;
    app.viewer.gltfRoot.traverse(o=>{
      const m = o.material;
      if(m){ fn(m,o); m.needsUpdate = true; }
    });
  }
  op.oninput = ()=> eachMaterials(m=>{ m.transparent = true; m.opacity = parseFloat(op.value); });
  let unlit=false;
  unlitBtn.onclick = ()=>{
    unlit = !unlit;
    unlitBtn.textContent = 'Unlit: ' + (unlit?'on':'off');
    eachMaterials(m=>{ m.lights = !unlit; m.needsUpdate = true; });
  };
  let ds=false;
  dsBtn.onclick = ()=>{
    ds = !ds; dsBtn.textContent = 'DoubleSide: ' + (ds?'on':'off');
    eachMaterials(m=>{ m.side = ds ? 2 : 0; });
  };

  // view tab
  const bg = document.getElementById('bg');
  bg.oninput = ()=> app.viewer.setBackground(bg.value);
}

// expose for boot
window.__LMY_setupUI = setupUI;
