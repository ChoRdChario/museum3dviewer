// ui.js — import-fix + tab wiring + model-loaded dispatch — 2025-10-07
import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js';

export function setupUI(app){
  const inputId = document.getElementById('fileIdInput');
  const btnLoad = document.getElementById('btnLoad');
  const spinner = document.getElementById('spinner');

  // Tabs
  (function setupTabs(){
    const tabs  = Array.from(document.querySelectorAll('.tab[data-tab]'));
    const panes = Array.from(document.querySelectorAll('.pane'));
    function activate(name){
      tabs.forEach(t => t.classList.toggle('active', t.dataset.tab === name));
      panes.forEach(p => p.classList.toggle('active', p.id === 'pane-' + name));
    }
    tabs.forEach(t => t.addEventListener('click', () => activate(t.dataset.tab)));
    const current = (tabs.find(t=>t.classList.contains('active'))?.dataset.tab) || (tabs[0]?.dataset.tab) || 'cap';
    activate(current);
  })();

  async function loadFromInput(ev){
    const raw = (inputId?.value || '').trim();
    if (!raw) return;
    const id = normalizeDriveIdFromInput(raw) || raw;
    if (spinner) spinner.textContent = 'loading model...';

    try{
      const buf = await fetchDriveFileAsArrayBuffer(id);
      if (!app.viewer || !app.viewer.loadGLB) throw new Error('viewer.loadGLB not available');
      await app.viewer.loadGLB(buf);
      app.state = app.state || {};
      app.state.currentGLBId = id;
      window.dispatchEvent(new CustomEvent('lmy:model-loaded', { detail: { glbId: id } }));
    }catch(e){
      console.error('[ui] failed to load', e);
      alert('Failed to load GLB: ' + (e?.message || e));
    }finally{
      spinner && spinner.remove?.();
    }
  }

  btnLoad?.addEventListener('click', loadFromInput);
  inputId?.addEventListener('keydown', (ev)=>{ if(ev.key==='Enter') loadFromInput(ev); });

  window.__ui = { loadFromInput };
}
