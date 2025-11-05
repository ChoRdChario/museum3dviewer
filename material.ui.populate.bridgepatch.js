// material.ui.populate.bridgepatch.js
const log = (...a)=>console.log('[populate-bridgepatch+]', ...a);
const warn = (...a)=>console.warn('[populate-bridgepatch+]', ...a);

function getSelect(){
  return document.querySelector('#pm-material')
      || document.querySelector('#materialSelect')
      || document.querySelector('select[name="materialKey"]')
      || document.querySelector('[data-lm="material-select"]')
      || document.querySelector('.lm-material-select')
      || document.querySelector('#materialPanel select')
      || document.querySelector('.material-panel select');
}

function uniqueMaterialsFromScene(scene){
  const map = new Map();
  scene.traverse(obj=>{
    const matsRaw = obj.material;
    if (!matsRaw) return;
    const arr = Array.isArray(matsRaw) ? matsRaw : [matsRaw];
    arr.forEach(m=>{
      if (!m) return;
      const name = (m.name && String(m.name).trim()) || '(no-name)';
      const rec = map.get(name) || { uses:0 };
      rec.uses += 1;
      map.set(name, rec);
    });
  });
  return Array.from(map.entries())
    .sort((a,b)=>b[1].uses - a[1].uses)
    .map(([name, rec])=>({ name, uses: rec.uses }));
}

async function readyScene(){
  if (window.lm?.readyScenePromise) return window.lm.readyScenePromise;
  return new Promise((res)=>{
    const handler = (e)=>{ window.removeEventListener('pm:scene-deep-ready', handler); res(e.detail?.scene || null); };
    window.addEventListener('pm:scene-deep-ready', handler, { once: true });
  });
}

async function populate(){
  log('script initialized');
  const sel = getSelect();
  if (!sel){ warn('select not found'); return; }
  sel.disabled = true;

  let scene;
  try {
    scene = await readyScene();
  } catch(e) {
    warn('readyScene failed', e);
  }
  if (!scene){ warn('scene not ready (timeout)'); return; }

  const mats = uniqueMaterialsFromScene(scene);
  sel.innerHTML = '';
  const ph = document.createElement('option');
  ph.textContent = '— Select material —';
  ph.value = '';
  sel.appendChild(ph);

  mats.forEach(({name})=>{
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    sel.appendChild(opt);
  });

  sel.disabled = false;
  log('populated', mats.length, 'materials');
}

populate().catch(e=>warn('populate error', e));
