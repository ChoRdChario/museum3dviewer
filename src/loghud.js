export class LogHUD{
  constructor(root, anchor){
    this.root = root; this.anchor = anchor;
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'position:absolute;right:12px;bottom:12px;min-width:280px;max-width:420px;max-height:40vh;overflow:auto;background:#10131a;border:1px solid var(--m3d-border);border-radius:12px;box-shadow:var(--m3d-shadow);display:none;padding:8px 10px;font-size:12px;white-space:pre-wrap;line-height:1.4';
    const chip = document.createElement('button');
    chip.textContent = 'ログ';
    chip.style.cssText = 'background:#1b2029;border:1px solid var(--m3d-border);color:var(--m3d-fg);border-radius:999px;padding:6px 12px;cursor:pointer';
    chip.addEventListener('click', ()=> this.toggle());
    anchor.appendChild(chip);
    root.appendChild(this.panel);
  }
  toggle(){ this.panel.style.display = (this.panel.style.display==='none'||!this.panel.style.display)?'block':'none'; }
  log(msg){
    const line = document.createElement('div');
    const ts = new Date().toLocaleTimeString();
    line.textContent = `[${ts}] ${msg}`;
    this.panel.appendChild(line);
    this.panel.scrollTop = this.panel.scrollHeight;
  }
}
