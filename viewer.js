// viewer.js
let state = {
  ready: false,
  container: null,
  glb: null,
  pins: [],
  currentColor: '#87ceeb',
};

function ensureViewer(containerEl) {
  state.container = containerEl;
  state.container.innerHTML = '';
  const msg = document.createElement('div');
  msg.className = 'booting';
  msg.textContent = 'ready';
  state.container.appendChild(msg);
  state.ready = true;
  console.info('[viewer] ready');
}

async function loadGLB(urlOrId) {
  console.info('[viewer] loadGLB requested', urlOrId || '(empty)');
  if (!state.container) return;
  let text = 'loaded: ';
  if (!urlOrId) text += '(empty)';
  else if (String(urlOrId).toLowerCase() === 'demo') text += 'demo';
  else text += String(urlOrId).slice(0, 28);
  state.container.querySelector('.booting')?.remove();
  const tip = document.createElement('div');
  tip.className = 'booting';
  tip.textContent = text;
  state.container.innerHTML = '';
  state.container.appendChild(tip);
  state.glb = urlOrId || null;
}

function setPinColor(hex) {
  state.currentColor = hex;
  console.info('[viewer] color set', hex);
}

function addPinAtCenter() {
  const id = String(Date.now());
  const pin = { id, x: 0, y: 0, z: 0, color: state.currentColor, title: '', body: '' };
  state.pins.push(pin);
  console.info('[viewer] pin added', pin);
  return id;
}

function setPinMeta(id, meta) {
  const p = state.pins.find(p => p.id === id);
  if (!p) return;
  Object.assign(p, meta || {});
}

function getPins() {
  return state.pins.slice();
}

async function refreshImages() {
  console.info('[viewer] refresh images (stub)');
}

export { ensureViewer, loadGLB, addPinAtCenter, setPinColor, refreshImages, setPinMeta, getPins };
