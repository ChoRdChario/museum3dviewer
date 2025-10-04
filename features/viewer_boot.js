// features/viewer_boot.js
// Boots the viewer and bridges 'lmy:load-glb-blob' to loadFromBlob().
import { initViewer, loadFromBlob } from './viewer_adapter.three.js';

function ensureStage(){
  let el = document.getElementById('stage');
  if (!el){
    el = document.createElement('div');
    el.id = 'stage';
    document.body.appendChild(el);
  }
  Object.assign(el.style, {position:'fixed', inset:'0', zIndex:'0'});
  return el;
}

const stage = ensureStage();
const vstate = initViewer(stage);

addEventListener('lmy:load-glb-blob', async (ev)=>{
  const { blob, name='model.glb' } = ev.detail || {};
  if (!(blob instanceof Blob)) return console.warn('[bridge] bad blob');
  console.log('[bridge] loadFromBlob', name, blob.size);
  try { await loadFromBlob(vstate, blob, name); } 
  catch(e){ console.warn('[bridge] failed', e); }
});

console.log('[viewer_boot] armed');