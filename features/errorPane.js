// features/errorPane.js
export function mountErrorPane() {
  const side = document.getElementById('side');
  if (!side) return;
  const box = document.createElement('div');
  box.id = 'error-pane';
  box.style.cssText = 'margin-top:12px;padding:8px;border:1px solid #442;background:#1a0000;color:#fbb; border-radius:8px; font-size:12px;';
  box.innerHTML = `<div style="font-weight:600;margin-bottom:6px;">Errors</div>
  <div>Count: <span id="err-count">0</span></div>
  <pre id="err-last" style="white-space:pre-wrap;max-height:160px;overflow:auto;margin:6px 0 0;"></pre>`;
  side.appendChild(box);
  const cntEl = box.querySelector('#err-count');
  const lastEl = box.querySelector('#err-last');
  let count = 0;
  function bump(msg) {
    count++; cntEl.textContent = String(count);
    lastEl.textContent = msg;
  }
  window.addEventListener('error', (e)=> bump(`${e.message}\n${e.filename}:${e.lineno}:${e.colno}\n${e.error?.stack||''}`));
  window.addEventListener('unhandledrejection', (e)=> bump(`UnhandledRejection: ${e.reason?.message||e.reason}\n${e.reason?.stack||''}`));
}
