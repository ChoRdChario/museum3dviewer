// LociMyu probe — robust boot with demo fallback
console.log('[probe] start');
const stage = document.getElementById('stage');
if (stage) {
  console.log('[probe] host #stage', stage.clientWidth, 'x', stage.clientHeight, 'disp=' + getComputedStyle(stage).display);
} else {
  console.warn('[probe] #stage not found — creating');
  const s = document.createElement('div');
  s.id = 'stage';
  s.style.position = 'relative';
  s.style.width = '100%';
  s.style.height = '100vh';
  s.style.background = '#111';
  document.body.appendChild(s);
}

const mount = document.getElementById('stage');

import('./fallback_viewer_bootstrap.js')
  .then(mod => mod.ensureDemo({ mount }))
  .catch(e => {
    console.error('[probe] demo mount failed', e);
    const p = document.createElement('pre');
    p.textContent = 'Boot failed. See console logs.';
    p.style.color = '#f66';
    p.style.position = 'absolute';
    p.style.top = '12px';
    p.style.left = '12px';
    document.body.appendChild(p);
  });
