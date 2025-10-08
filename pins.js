// pins.js
import { ensureViewer, loadGLB, addPinAtCenter, setPinColor, refreshImages, setPinMeta, getPins } from './viewer.js';

let els = {};
let current = {
  color: '#87ceeb',
  selectedPinId: null,
  signed: false,
};

const COLORS = ['#3b82f6','#22c55e','#f59e0b','#ef4444','#a855f7','#10b981','#eab308','#f97316','#64748b','#e2e8f0'];

window.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  buildColorSwatches();
  buildFilterOptions();
  wireTabs();
  wireAuth();
  wireCaptionPanel();

  await ensureViewer(els.viewer);
  console.log('[pins] ready');
});

function cacheElements() {
  els.viewer = document.getElementById('viewer');
  els.tabs = document.querySelectorAll('.tab');
  els.panels = document.querySelectorAll('.panel');
  els.sign = document.getElementById('btnSign');

  // caption panel
  els.driveInput = document.getElementById('driveInput');
  els.btnGlbLoad = document.getElementById('btnGlbLoad');
  els.saveSelect = document.getElementById('saveSelect');
  els.btnSaveAdd = document.getElementById('btnSaveAdd');
  els.pinColors = document.getElementById('pinColors');
  els.filterSelect = document.getElementById('filterSelect');
  els.captionList = document.getElementById('captionList');
  els.titleInput = document.getElementById('titleInput');
  els.bodyInput = document.getElementById('bodyInput');
  els.btnAddPin = document.getElementById('btnAddPin');
  els.btnClear = document.getElementById('btnClear');
  els.btnRefreshImages = document.getElementById('btnRefreshImages');
}

function buildColorSwatches() {
  els.pinColors.innerHTML = '';
  COLORS.forEach((hex, i) => {
    const sw = document.createElement('div');
    sw.className = 'swatch' + (i===0 ? ' active' : '');
    sw.dataset.pinColor = hex;
    sw.style.background = hex;
    sw.title = hex;
    sw.addEventListener('click', () => {
      document.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      current.color = hex;
      setPinColor(hex);
    });
    els.pinColors.appendChild(sw);
  });
}

function buildFilterOptions() {
  // (All) のみ
}

function wireTabs() {
  els.tabs.forEach(btn => btn.addEventListener('click', () => {
    const name = btn.dataset.tab;
    els.tabs.forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('[data-panel]').forEach(p => {
      p.style.display = (p.dataset.panel === name) ? 'block' : 'none';
    });
  }));
}

function wireAuth() {
  els.sign.addEventListener('click', () => {
    current.signed = !current.signed;
    els.sign.textContent = current.signed ? 'Sign out' : 'Sign in';
    console.info('[auth] toggled', current.signed);
  });
}

function wireCaptionPanel() {
  els.btnGlbLoad.addEventListener('click', () => {
    const v = (els.driveInput.value || '').trim();
    loadGLB(v || 'demo');
  });

  els.btnSaveAdd.addEventListener('click', () => {
    const name = prompt('New set name?');
    if (!name) return;
    const opt = document.createElement('option');
    opt.value = opt.textContent = name;
    els.saveSelect.appendChild(opt);
    els.saveSelect.value = name;
  });

  els.btnAddPin.addEventListener('click', () => {
    const id = addPinAtCenter();
    const title = els.titleInput.value.trim();
    const body  = els.bodyInput.value.trim();
    setPinMeta(id, { title, body, color: current.color });
    renderCaptionList();
    if (title || body) {
      els.titleInput.value = '';
      els.bodyInput.value = '';
    }
  });

  els.btnClear.addEventListener('click', () => {
    els.titleInput.value = '';
    els.bodyInput.value = '';
    current.selectedPinId = null;
    document.querySelectorAll('.item').forEach(i => i.classList.remove('active'));
  });

  els.btnRefreshImages.addEventListener('click', () => {
    refreshImages();
  });
}

function renderCaptionList() {
  const pins = getPins();
  els.captionList.innerHTML = '';
  pins.forEach(p => {
    const div = document.createElement('div');
    div.className = 'item';
    div.textContent = p.title || '(untitled)';
    div.dataset.id = p.id;
    div.addEventListener('click', () => {
      current.selectedPinId = p.id;
      document.querySelectorAll('.item').forEach(i => i.classList.remove('active'));
      div.classList.add('active');
      els.titleInput.value = p.title || '';
      els.bodyInput.value = p.body || '';
    });
    els.captionList.appendChild(div);
  });
}

// 初期色を viewer に反映
setPinColor(current.color);
