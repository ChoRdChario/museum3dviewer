export class Toasts{
  constructor(root){
    this.root = root;
    this.host = document.createElement('div');
    this.host.setAttribute('part','toasts');
    Object.assign(this.host.style, { position:'absolute', right:'12px', top:'12px', display:'grid', gap:'8px', zIndex:'9999' });
    root.appendChild(this.host);
  }
  push(message, {type='info', timeout=3500}={}){
    const el = document.createElement('div');
    el.setAttribute('role','status');
    el.style.cssText = 'background:#1b2029;border:1px solid var(--m3d-border);color:var(--m3d-fg);padding:10px 12px;border-radius:10px;box-shadow:var(--m3d-shadow);font-size:13px;max-width:360px';
    if (type==='error'){ el.style.borderColor = 'var(--m3d-danger)'; }
    el.textContent = message;
    this.host.appendChild(el);
    setTimeout(()=> el.remove(), timeout);
  }
}
