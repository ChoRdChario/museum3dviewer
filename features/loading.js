
// features/loading.js  (v6.6.3)
let spinnerEl = null;
let toastHost = null;

function ensureContainers() {
  if (!spinnerEl) {
    spinnerEl = document.createElement('div');
    spinnerEl.id = 'lmy-spinner';
    Object.assign(spinnerEl.style, {
      position: 'fixed', inset: '0', display: 'none', alignItems: 'center',
      justifyContent: 'center', zIndex: '9999', backdropFilter: 'blur(2px)',
      background: 'rgba(0,0,0,0.15)'
    });
    const ring = document.createElement('div');
    Object.assign(ring.style, {
      width: '64px', height: '64px', borderRadius: '50%',
      border: '6px solid #ccc', borderTopColor: '#09f',
      animation: 'lmy-spin 1s linear infinite'
    });
    spinnerEl.appendChild(ring);
    const style = document.createElement('style');
    style.textContent = `@keyframes lmy-spin{to{transform: rotate(360deg)}}`;
    spinnerEl.appendChild(style);
    document.body.appendChild(spinnerEl);
  }
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.id = 'lmy-toast-host';
    Object.assign(toastHost.style, {
      position: 'fixed', right: '12px', bottom: '12px',
      display: 'flex', flexDirection: 'column', gap: '8px', zIndex: '10000'
    });
    document.body.appendChild(toastHost);
  }
}

export function showSpinner(label = '') {
  ensureContainers();
  spinnerEl.style.display = 'flex';
  spinnerEl.setAttribute('aria-busy', 'true');
}

export function hideSpinner() {
  ensureContainers();
  spinnerEl.style.display = 'none';
  spinnerEl.removeAttribute('aria-busy');
}

function pushToast(text, kind) {
  ensureContainers();
  const card = document.createElement('div');
  Object.assign(card.style, {
    background: kind === 'error' ? '#ffefef' : (kind === 'info' ? '#eef6ff' : '#efffed'),
    color: '#222', border: '1px solid rgba(0,0,0,0.1)',
    boxShadow: '0 2px 8px rgba(0,0,0,0.12)', borderRadius: '10px',
    padding: '10px 12px', fontSize: '14px', maxWidth: '320px'
  });
  card.textContent = text;
  toastHost.appendChild(card);
  setTimeout(() => {
    card.style.opacity = '0';
    card.style.transition = 'opacity .3s ease';
    setTimeout(() => card.remove(), 350);
  }, 2800);
}

export const toast = {
  success: (t) => pushToast(t, 'success'),
  error:   (t) => pushToast(t, 'error'),
  info:    (t) => pushToast(t, 'info'),
};
