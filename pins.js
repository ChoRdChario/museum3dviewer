// pins.js (ESM)
// UI の存在を検証し、最低限の配線を行う。詳細機能は後続ステップで拡張。
import { ensureViewer } from './viewer.js';

const q = (sel) => /** @type {HTMLElement|null} */(document.querySelector(sel));
const qa = (sel) => /** @type {NodeListOf<HTMLElement>} */(document.querySelectorAll(sel));

function elRequired(id, el) {
  if (!el) throw new Error(`[pins] required element missing: ${id}`);
  return el;
}

function setupTabs() {
  const tabs = qa('#tabs .tab');
  const pages = qa('.tabpage');
  tabs.forEach(btn => {
    btn.addEventListener('click', () => {
      tabs.forEach(b => b.classList.remove('active'));
      pages.forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      const name = btn.getAttribute('data-tab');
      q(`#tab-${name}`)?.classList.add('active');
    });
  });
}

function setupAuth() {
  const btnSignin = elRequired('#btnSignin', q('#btnSignin'));
  btnSignin.addEventListener('click', () => {
    console.log('[auth] sign-in clicked (stub)');
    btnSignin.classList.toggle('on');
    btnSignin.textContent = btnSignin.classList.contains('on') ? 'Signed in' : 'Sign in';
  });
}

function setupPinFilters() {
  const filterAll = /** @type {HTMLInputElement} */(elRequired('#filterAll', q('#filterAll')));
  const dots = qa('#pinFilters .dot');
  filterAll.addEventListener('change', () => {
    const on = filterAll.checked;
    dots.forEach(d => d.classList.toggle('off', !on));
  });
  dots.forEach(dot => {
    dot.addEventListener('click', () => {
      filterAll.checked = false;
      dot.classList.toggle('off');
      console.log('[pins] filter toggled', dot.dataset.color, !dot.classList.contains('off'));
    });
  });
}

function setupCaptionIO() {
  const inputDrive = /** @type {HTMLInputElement} */(elRequired('#inputDrive', q('#inputDrive')));
  const btnLoadGLB = elRequired('#btnLoadGLB', q('#btnLoadGLB'));
  const btnRefresh = elRequired('#btnRefreshImages', q('#btnRefreshImages'));
  const btnAddPin = elRequired('#btnAddPin', q('#btnAddPin'));
  const title = /** @type {HTMLInputElement} */(elRequired('#inputTitle', q('#inputTitle')));
  const body  = /** @type {HTMLTextAreaElement} */(elRequired('#inputBody', q('#inputBody')));

  btnLoadGLB.addEventListener('click', async () => {
    const v = inputDrive.value.trim();
    console.log('[GLB] requested load', v || '(demo)');
    await ensureViewer(); // ビューア起動のみ（GLBロードは後続実装）
  });

  btnRefresh.addEventListener('click', () => {
    console.log('[images] refresh requested');
  });

  btnAddPin.addEventListener('click', () => {
    console.log('[pins] +Pin clicked (use Shift+Click on viewer in future)');
  });

  const persist = () => {
    console.log('[caption] persist draft', { title: title.value, body: body.value });
  };
  title.addEventListener('input', persist);
  body.addEventListener('input', persist);
}

function bootPins() {
  try {
    setupTabs();
    setupAuth();
    setupPinFilters();
    setupCaptionIO();
    console.info('[pins] ready');
  } catch (err) {
    console.error('[pins] required elements missing', err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootPins();
});
