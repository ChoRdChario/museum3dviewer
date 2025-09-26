import { LocimyuCore } from '../locimyu-core.js';
import { Viewer } from './viewer.js';
import { PinsPane } from './pins-list.js';
import { Toasts } from './toast.js';
import { LogHUD } from './loghud.js';
import { createStore } from './state.js';
import { i18n } from './i18n.js';

const tpl = document.createElement('template');
tpl.innerHTML = `
  <style>
    :host{display:block;position:relative;}
    .wrap{position:relative;inset:0;display:grid;grid-template-rows:var(--m3d-toolbar-h) 1fr;}
    header{display:flex;align-items:center;gap:8px;padding:0 10px;height:var(--m3d-toolbar-h);background:var(--m3d-surface);border-bottom:1px solid var(--m3d-border);} 
    header .brand{font-weight:600;opacity:.9;}
    header input[type="text"]{flex:1;min-width:160px;background:#0c0e12;border:1px solid var(--m3d-border);color:var(--m3d-fg);border-radius:8px;padding:6px 10px;}
    header button, header .seg > button{background:#1b2029;border:1px solid var(--m3d-border);color:var(--m3d-fg);border-radius:10px;padding:6px 10px;cursor:pointer}
    header button[disabled]{opacity:.5;cursor:not-allowed}
    header .seg{display:inline-flex;gap:2px;border-radius:10px;}

    .main{position:relative;}
    .viewer{position:absolute;inset:0;z-index:var(--m3d-z-view)}
    .right{position:absolute;top:var(--m3d-toolbar-h);right:0;height:calc(100vh - var(--m3d-toolbar-h));width:var(--m3d-rightpane-w);background:var(--m3d-surface);border-left:1px solid var(--m3d-border);z-index:var(--m3d-z-right);display:none}
    .right.open{display:block}

    .mb-bar{position:absolute;left:0;right:0;bottom:0;height:56px;background:rgba(20,23,30,.9);display:none;align-items:center;justify-content:space-around;border-top:1px solid var(--m3d-border);backdrop-filter:saturate(140%) blur(6px);}
    .mb-bar button{background:transparent;border:none;color:var(--m3d-fg);font-size:13px}

    .sheet{position:absolute;left:0;right:0;bottom:0;max-height:75vh;background:var(--m3d-surface);border-top:1px solid var(--m3d-border);border-top-left-radius:16px;border-top-right-radius:16px;transform:translateY(100%);transition:transform .24s ease;box-shadow:var(--m3d-shadow);}
    .sheet.open{transform:translateY(0)}

    .spinner{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.35);z-index:var(--m3d-z-spinner)}
    .spinner.show{display:flex}

    .hud-anchor{position:absolute;left:12px;bottom:12px;z-index:var(--m3d-z-hud)}

    @media (min-width:1024px){
      .right{display:block}
      .mb-bar{display:none}
      .sheet{display:none}
    }
    @media (max-width:1023px){
      .right{display:none}
      .mb-bar{display:flex}
    }
  </style>
  <div class="wrap" part="wrap">
    <header part="toolbar" role="toolbar" aria-label="Toolbar">
      <div class="brand" aria-hidden="true">Locimyu</div>
      <input part="glb-input" type="text" placeholder="Drive 共有URL または FileId" aria-label="GLB 入力" />
      <button part="load" data-act="load">読み込み</button>
      <div class="seg" role="group" aria-label="View">
        <button part="btn-view" data-act="toggle-right">右ペイン</button>
        <button part="btn-focus" data-act="focus">原点</button>
      </div>
      <span part="status" aria-live="polite" style="opacity:.7;font-size:12px"></span>
      <div style="flex:1"></div>
      <button part="signin" data-act="signin">サインイン</button>
      <button part="signout" data-act="signout">サインアウト</button>
    </header>
    <div class="main">
      <div class="viewer" part="viewer" aria-label="3D Viewer"></div>
      <div class="right" part="right-pane"></div>
      <div class="mb-bar" part="mobile-bar" aria-label="Mobile Actions">
        <button data-act="mb-list">一覧</button>
        <button data-act="mb-read">読書</button>
        <button data-act="mb-add" data-role="edit-only">追加</button>
      </div>
      <div class="sheet" part="bottom-sheet" aria-label="Details"></div>
      <div class="spinner" part="spinner"><div>読み込み中…</div></div>
      <div class="hud-anchor"></div>
    </div>
  </div>
`;

export class LocimyuUI extends HTMLElement{
  #root; #refs; #viewer; #core; #store; #toasts; #hud; #pinsPane; #viewMode;
  constructor(){
    super();
    this.#root = this.attachShadow({mode:'open'});
    this.#root.appendChild(tpl.content.cloneNode(true));

    const qs = (sel) => this.#root.querySelector(sel);
    this.#refs = {
      wrap: qs('.wrap'),
      toolbar: qs('header'),
      input: qs('input[type="text"]'),
      btnLoad: qs('[data-act="load"]'),
      btnToggleRight: qs('[data-act="toggle-right"]'),
      btnFocus: qs('[data-act="focus"]'),
      status: qs('[part="status"]'),
      viewer: qs('.viewer'),
      right: qs('.right'),
      mbBar: qs('.mb-bar'),
      sheet: qs('.sheet'),
      spinner: qs('.spinner'),
      hudAnchor: qs('.hud-anchor'),
      btnSignin: qs('[data-act="signin"]'),
      btnSignout: qs('[data-act="signout"]'),
      btnMbList: qs('[data-act="mb-list"]'),
      btnMbRead: qs('[data-act="mb-read"]'),
      btnMbAdd: qs('[data-act="mb-add"]'),
    };

    const url = new URL(location.href);
    this.#viewMode = url.searchParams.get('view') === '1';

    this.#store = createStore();
    this.#toasts = new Toasts(this.#root);
    this.#hud = new LogHUD(this.#root, this.#refs.hudAnchor);

    this.#core = new LocimyuCore({ gapi: window.gapi });
    this.#viewer = new Viewer();
    this.#viewer.mount(this.#refs.viewer);

    this.#pinsPane = new PinsPane({ i18n, viewMode: this.#viewMode });
    this.#refs.right.appendChild(this.#pinsPane.el);
    this.#refs.sheet.appendChild(this.#pinsPane.sheetEl);

    this.#core.addEventListener('auth:ready', () => {
      this.#log('auth:ready');
      this.#toasts.push('Google API 初期化が完了しました');
    });
    this.#core.addEventListener('glb:meta', (e) => {
      const { fileId, name } = e.detail||{};
      this.#log(`glb:meta fileId=${fileId} name=${name||''}`);
    });
    this.#core.addEventListener('glb:url', (e) => {
      const { objectUrl, fileId } = e.detail;
      this.#log('glb:url 受領 → three.js でロード');
      this.#status('GLB 読み込み中…');
      this.#spinner(true);
      this.#viewer.loadFromObjectURL(objectUrl)
        .then(() => {
          this.#status('3Dモデル 読み込み完了');
          this.#spinner(false);
          this.#core.resolvePinSpreadsheet(fileId).catch(err=>this.#err(err));
        })
        .catch(err => { this.#spinner(false); this.#err(err); });
    });
    this.#core.addEventListener('sheet:resolved', (e) => {
      const { sheetId, name } = e.detail||{};
      this.#log(`sheet:resolved id=${sheetId} name=${name||''}`);
      this.#status('ピン情報を取得中…');
      this.#spinner(true);
      this.#core.loadPins(sheetId)
        .catch(err => this.#err(err))
        .finally(()=> this.#spinner(false));
    });
    this.#core.addEventListener('pins:loaded', (e) => {
      const { pins, sheetId } = e.detail||{};
      this.#log(`pins:loaded N=${pins?.length||0} sheet=${sheetId||''}`);
      this.#status(`${pins?.length||0} 件のピン`);
      this.#pinsPane.setPins(pins||[]);
    });
    this.#core.addEventListener('error', (e) => this.#err(e.detail||e));

    this.#refs.btnLoad.addEventListener('click', () => {
      const v = (this.#refs.input.value||'').trim();
      if (!v){ this.#toasts.push('Drive 共有URL または FileId を入力してください'); return; }
      this.#log('UI: loadGLB');
      this.#spinner(true);
      this.#core.loadGLB(v).catch(err => this.#err(err)).finally(()=> this.#spinner(false));
    });
    this.#refs.btnToggleRight.addEventListener('click', () => {
      this.#refs.right.classList.toggle('open');
    });
    this.#refs.btnFocus.addEventListener('click', () => this.#viewer.focusOrigin());

    this.#refs.btnMbList.addEventListener('click', () => this.#pinsPane.openSheet('list'));
    this.#refs.btnMbRead.addEventListener('click', () => this.#pinsPane.openSheet('detail'));
    this.#refs.btnMbAdd.addEventListener('click', () => {
      if (this.#viewMode){ this.#toasts.push('閲覧モードでは編集できません'); return; }
      this.#toasts.push('追加UIは今後の拡張枠です');
    });

    this.#refs.btnSignin.addEventListener('click', async () => {
      try{
        this.#spinner(true);
        const cfg = window.LOCIMYU_GAPI_CONFIG || {
          apiKey: 'YOUR_API_KEY',
          clientId: 'YOUR_CLIENT_ID',
          scopes: [
            'https://www.googleapis.com/auth/drive.readonly',
            'https://www.googleapis.com/auth/spreadsheets.readonly'
          ]
        };
        await this.#core.initGapi(cfg);
        this.#status('サインイン準備 OK');
        this.#toasts.push('必要に応じてポップアップでサインインしてください');
      }catch(err){ this.#err(err); }
      finally{ this.#spinner(false); }
    });
    this.#refs.btnSignout.addEventListener('click', async () => {
      try{
        if (gapi?.client?.setToken) gapi.client.setToken('');
        this.#toasts.push('サインアウトしました');
      }catch(err){ this.#err(err); }
    });

    if (this.#viewMode){
      this.#root.querySelectorAll('[data-role="edit-only"]').forEach(el=> el.setAttribute('disabled','disabled'));
    }
  }

  #status(msg){ this.#refs.status.textContent = msg||''; }
  #spinner(v){ this.#refs.spinner.classList.toggle('show', !!v); }
  #log(msg){ this.#hud.log(msg); }
  #err(err){ const m = (err?.message||err+''||'Error'); this.#hud.log('ERROR: '+m); this.#toasts.push(m, {type:'error'}); }
}

customElements.define('locimyu-ui', LocimyuUI);
