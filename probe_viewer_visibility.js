// probe_viewer_visibility.js — boot the fallback demo using CDN three.js
console.log('[probe] start');
const stage = document.getElementById('stage');
console.log('[probe] host #stage', stage?.clientWidth, 'x', stage?.clientHeight, 'disp=' + getComputedStyle(stage).display);

import('./fallback_viewer_bootstrap.js?v=20251004a')
  .then(mod => mod.ensureDemo({ mount: stage }))
  .catch(e => {
    console.error('[probe] demo mount failed', e);
    const p = document.createElement('pre');
    p.className = 'err';
    p.textContent = 'Boot failed. See console logs.';
    document.body.appendChild(p);
  });
