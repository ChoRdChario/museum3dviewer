// app_boot.js
import { ensureViewer, loadGLB, setBackground, setProjection } from './viewer.js';
import { setupPins } from './pins.js';
import { setupUI } from './ui.js';
import { setupAuth } from './gauth.module.js';

const log = (...a)=>console.log('[boot]', ...a);

async function boot(){
  console.log('[auth] ready');

  // Viewer
  try{
    await ensureViewer({ mount:'#stage', spinner:'#spinner' });
  }catch(e){
    console.error('[boot] ensureViewer failed', e);
  }

  // Auth chip
  try{
    await setupAuth('#authChip');
  }catch(e){
    console.error('[boot] setupAuth failed', e);
  }

  // UI wiring (tabs, inputs)
  setupUI({
    onLoadGLB: async (fileIdOrUrl)=>{
      await loadGLB(fileIdOrUrl);
    },
    onBg: (hex)=> setBackground(hex),
    onProj: (mode)=> setProjection(mode),
  });

  // Pins
  try{
    setupPins({
      capList:'#capList',
      capTitle:'#capTitle',
      capBody:'#capBody',
      pinPalette:'#pinPalette',
      pinFilter:'#pinFilter',
      btnAdd:'#btnAddPin',
      btnRefresh:'#btnRefreshImages',
    });
  }catch(e){
    console.error('[pins] setup failed', e);
  }
}

if (document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', boot, { once:true });
}else{
  boot();
}
