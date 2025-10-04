import { fetchDriveFileAsArrayBuffer, normalizeDriveIdFromInput } from './utils_drive_api.js?v=20251004api2';
import { driveListImagesInSameFolder } from './utils_drive_images.js?v=20251004img2';

const PALETTE = [
  { key:'amber', hex:'#ffcc55' },
  { key:'sky',   hex:'#55ccff' },
  { key:'lime',  hex:'#a3e635' },
  { key:'rose',  hex:'#f43f5e' },
  { key:'violet',hex:'#8b5cf6' },
  { key:'slate', hex:'#94a3b8' }
];

function pickIdFromUI(){
  const input = document.getElementById('fileIdInput');
  const raw = (input?.value ?? '').trim();
  if (raw) return raw;
  const params = new URLSearchParams(location.search);
  const qid = (params.get('id') ?? '').trim();
  if (qid) return qid;
  return '';
}

export function setupUI(app){
  const el = {
    fileId: document.getElementById('fileIdInput'),
    btnLoad: document.getElementById('btnLoad'),
    spinner: document.getElementById('spinner'),

    tabs: Array.from(document.querySelectorAll('.tab')),
    panes: {
      cap: document.getElementById('pane-cap'),
      mat: document.getElementById('pane-mat'),
      view: document.getElementById('pane-view'),
    },

    // Caption
    imgGrid: document.getElementById('imgGrid'),
    pinPalette: document.getElementById('pinPalette'),
    pinFilter: document.getElementById('pinFilter'),
    btnRefreshImages: document.getElementById('btnRefreshImages'),

    // Material
    matSelect: document.getElementById('matSelect'),
    hue: document.getElementById('slHue'),
    sat: document.getElementById('slSat'),
    light: document.getElementById('slLight'),
    opac: document.getElementById('slOpacity'),
    unlit: document.getElementById('btnUnlit'),
    dbl: document.getElementById('btnDouble'),

    // View
    btnProj: document.getElementById('btnProj'),
  };

  // Tabs
  const activate = (key)=>{
    el.tabs.forEach(t=> t.classList.toggle('active', t.dataset.tab===key));
    Object.entries(el.panes).forEach(([k,p])=> p.classList.toggle('active', k===key));
  };
  el.tabs.forEach(t=> t.addEventListener('click', ()=> activate(t.dataset.tab)));
  activate('cap');

  // Build palette UI
  function buildPalette(){
    el.pinPalette.innerHTML = PALETTE.map((c,i)=>`<div class="sw${i===0?' active':''}" data-key="${c.key}" title="${c.key}" style="background:${c.hex}"></div>`).join('');
    el.pinFilter.innerHTML = '<option value="all">(All)</option>' + PALETTE.map(c=>`<option value="${c.hex}">${c.key}</option>`).join('');
    app.state.pinColor = PALETTE[0].hex;
    el.pinPalette.querySelectorAll('.sw').forEach(sw=> sw.addEventListener('click', ()=>{
      el.pinPalette.querySelectorAll('.sw').forEach(x=> x.classList.remove('active'));
      sw.classList.add('active');
      const key = sw.dataset.key;
      const hit = PALETTE.find(p=>p.key===key);
      app.state.pinColor = hit?.hex || PALETTE[0].hex;
      window.dispatchEvent(new CustomEvent('lmy:pin-color-changed', { detail:{ hex: app.state.pinColor } }));
    }));
  }
  buildPalette();

  // Load GLB
  el.btnLoad.addEventListener('click', async ()=>{
    const raw = pickIdFromUI();
    if (!raw){ el.spinner.textContent='file id/url is empty'; return; }
    try{
      el.spinner.textContent='loading GLB…';
      const id = normalizeDriveIdFromInput(raw);
      app.state.currentGLBId = id;
      const buf = await fetchDriveFileAsArrayBuffer(id);
      await app.viewer.loadGLBFromArrayBuffer(buf);
      el.spinner.textContent=''; el.spinner.remove();
      await populateImages();
    }catch(err){
      console.error('[ui] failed to load', err);
      el.spinner.textContent = 'failed: ' + (err?.message || 'see console');
    }
  });

  // Re-populate images on model loaded and manual refresh
  window.addEventListener('lmy:model-loaded', ()=> populateImages() );
  el.btnRefreshImages.addEventListener('click', ()=> populateImages() );

  async function populateImages(){
    try{
      const id = app.state.currentGLBId; if (!id) return;
      const list = await driveListImagesInSameFolder(id);
      if (!list.length){
        el.imgGrid.innerHTML = '<div class="muted" style="padding:.5rem">同階層に画像がありません</div>';
        return;
      }
      el.imgGrid.innerHTML = list.map(f => `<div class="card"><img src="https://lh3.googleusercontent.com/d/${f.id}=w256-h256" data-id="${f.id}" alt="${f.name}" title="${f.name}"></div>`).join('');
    }catch(e){
      console.error('[ui] image list failed', e);
      el.imgGrid.innerHTML = '<div class="muted" style="padding:.5rem">画像の列挙に失敗しました</div>';
    }
  }

  // Material
  const getSelIndex = ()=> { const i = parseInt(el.matSelect.value,10); return isNaN(i)||i<0 ? null : i; };
  const applyHSL = ()=> app.viewer.setHSL(+el.hue.value, +el.sat.value, +el.light.value, getSelIndex());
  const applyOpacity = ()=> app.viewer.setOpacity(+el.opac.value/100, getSelIndex());
  el.hue.addEventListener('input', applyHSL);
  el.sat.addEventListener('input', applyHSL);
  el.light.addEventListener('input', applyHSL);
  el.opac.addEventListener('input', applyOpacity);
  el.unlit.addEventListener('click', ()=>{
    app.state.unlit = !app.state.unlit;
    app.viewer.setUnlit(app.state.unlit, getSelIndex());
    el.unlit.textContent = 'Unlit: ' + (app.state.unlit?'on':'off');
  });
  el.dbl.addEventListener('click', ()=>{
    app.state.doubleSide = !app.state.doubleSide;
    app.viewer.setDoubleSide(app.state.doubleSide, getSelIndex());
    el.dbl.textContent = 'DoubleSide: ' + (app.state.doubleSide?'on':'off');
  });
  window.addEventListener('lmy:model-loaded', (e)=>{
    const mats = e.detail?.materials || [];
    el.matSelect.innerHTML = '<option value="-1">(All)</option>' + mats.map(m=>`<option value="${m.index}">${m.index}: ${m.name}</option>`).join('');
  });

  // View
  document.querySelectorAll('.btn.vp').forEach(b=> b.addEventListener('click', ()=> app.viewer.setViewPreset(b.dataset.vp)));
  document.querySelectorAll('.btn.bg').forEach(b=> b.addEventListener('click', ()=> app.viewer.setBackground(b.dataset.bg)));
  el.btnProj.addEventListener('click', ()=>{
    const next = el.btnProj.textContent.includes('persp') ? 'ortho' : 'persp';
    app.viewer.setProjection(next);
    el.btnProj.textContent = 'Projection: ' + next;
  });
}
