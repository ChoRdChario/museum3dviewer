// ui.captions.patch.js — wires the existing Captions tab without changing layout
import { PinManager } from './pins.js';
import { getAccessToken } from './gauth.js';

// This module only attaches logic to existing elements if they exist.
export function wireCaptions(viewer){
  const wrap = viewer.renderer.domElement.parentElement; // assumed #viewerWrap
  const capList = document.getElementById('capList');
  const btnAdd  = document.getElementById('btnAddPin');
  const btnSave = document.getElementById('btnSave');

  if (!wrap || !capList) return;

  const mgr = new PinManager(viewer, { viewerWrapEl: wrap, capListEl: capList });

  if (btnAdd){
    btnAdd.addEventListener('click', ()=> mgr.startPlacing());
  }

  if (btnSave){
    btnSave.addEventListener('click', ()=>{
      // For now: JSON download. Next step: push to Google Sheets / Drive.
      const data = mgr.toJSON();
      const blob = new Blob([JSON.stringify({ pins: data }, null, 2)], {type:'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'captions.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });
  }

  // expose for debugging
  window._pins = mgr;
}
