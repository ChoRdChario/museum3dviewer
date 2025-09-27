// locimyu-ui.js
import { LocimyuCore } from './locimyu-core.js';
import { M3DViewer } from './viewer.js';

class LocimyuApp extends HTMLElement{
  constructor(){
    super();
    this.attachShadow({mode:'open'});
    this.core = null; this.viewer = null; this.pins = []; this.viewMode = false;
    this._render();
  }
  connectedCallback(){ this._wire(); this._boot(); }
  _render(){
    const css = `
      :host{ all:initial; display:block; }
      .wrap{ position:relative; height:100vh; color:#e8eaed; }
      .toolbar{ position:fixed; left:0; right:0; top:0; height:48px; display:flex; align-items:center; gap:8px; padding:0 12px;
        background:rgba(10,12,16,0.9); backdrop-filter:saturate(180%) blur(10px); border-bottom:1px solid rgba(255,255,255,0.06); z-index:20; }
      .toolbar input[type="text"]{ flex:1; min-width:240px; background:#13161b; color:#fff; border:1px solid #2b3138; border-radius:8px; padding:8px 10px; outline:none; }
      .btn{ appearance:none; background:#1f6feb; color:#fff; border:none; border-radius:8px; padding:8px 12px; cursor:pointer; font-weight:600; }
      .btn:disabled{ opacity:.6; cursor:not-allowed; }
      .viewer{ position:absolute; left:0; right:360px; top:48px; bottom:0; }
      .right{ position:fixed; top:48px; right:0; width:360px; height:calc(100vh - 48px); background:#0f1216; border-left:1px solid rgba(255,255,255,0.06);
        display:flex; flex-direction:column; z-index:10; }
      .right .list{ flex:1; overflow:auto; padding:8px; }
      .right .detail{ height:220px; border-top:1px solid rgba(255,255,255,0.06); padding:8px; overflow:auto; }
      .row{ padding:8px; border:1px solid rgba(255,255,255,0.06); border-radius:8px; margin-bottom:8px; cursor:pointer; background:#101419; }
      .row:hover{ background:#121821; }
      .chip{ position:fixed; left:12px; bottom:12px; padding:8px 12px; border-radius:999px; background:#222; border:1px solid #444; color:#fff; z-index:30; cursor:pointer; }
      .hud{ position:fixed; right:12px; bottom:58px; width:340px; max-height:46vh; overflow:auto; padding:10px; border-radius:12px; background:rgba(0,0,0,.85); color:#fff; display:none; z-index:29; }
      .busy{ position:fixed; inset:0; display:none; align-items:center; justify-content:center; z-index:40; background:rgba(0,0,0,.3); }
      .spinner{ width:48px; height:48px; border:4px solid rgba(255,255,255,.3); border-top-color:#fff; border-radius:50%; animation:spin 1s linear infinite; margin:0 auto 10px; }
      @keyframes spin{ to{ transform: rotate(360deg); } }
      @media (max-width: 900px){
        .viewer{ right:0; }
        .right{ display:none; }
        .toolbar input[type="text"]{ min-width:160px; }
      }
    `.replace(/\n+/g,'\n');
    const html = `
      <div class="wrap">
        <div class="toolbar">
          <input id="input" type="text" placeholder="Drive共有URL または 30文字以上のFileId を貼り付け" />
          <button id="btnLoad" class="btn">読み込み</button>
          <button id="btnSignin" class="btn" title="Googleにサインイン">サインイン</button>
          <button id="btnView" class="btn" title="閲覧モード切替">View</button>
        </div>
        <div class="viewer"><div id="viewer"></div></div>
        <aside class="right">
          <div class="list" id="list">ピンを読み込み中…</div>
          <div class="detail" id="detail">ピンを選択すると詳細が表示されます</div>
        </aside>
        <button id="chip" class="chip">診断ログ</button>
        <div id="hud" class="hud"><div><strong>診断ログ</strong></div><div id="log"></div></div>
        <div id="busy" class="busy"><div><div class="spinner"></div><div id="busyMsg" style="text-align:center;color:#fff;">通信中…</div></div></div>
      </div>
    `;
    this.shadowRoot.innerHTML = `<style>${css}</style>${html}`;
  }
  _wire(){
    const s = this.shadowRoot;
    this.$input = s.getElementById('input');
    this.$btnLoad = s.getElementById('btnLoad');
    this.$btnSignin = s.getElementById('btnSignin');
    this.$btnView = s.getElementById('btnView');
    this.$viewer = s.getElementById('viewer');
    this.$list = s.getElementById('list');
    this.$detail = s.getElementById('detail');
    this.$chip = s.getElementById('chip');
    this.$hud = s.getElementById('hud');
    this.$log = s.getElementById('log');
    this.$busy = s.getElementById('busy');
    this.$busyMsg = s.getElementById('busyMsg');

    this.$chip.addEventListener('click', ()=>{
      this.$hud.style.display = (this.$hud.style.display==='none'||!this.$hud.style.display)?'block':'none';
      this.$hud.scrollTop = this.$hud.scrollHeight;
    });
    this.$btnLoad.addEventListener('click', ()=> this._onLoad());
    this.$btnSignin.addEventListener('click', ()=> this._onSignin());
    this.$btnView.addEventListener('click', ()=> this._toggleView());
  }
  _boot(){
    try{ this.viewMode = (new URLSearchParams(location.search)).get('view') === '1'; }catch(_){ this.viewMode=false; }
    if (this.viewMode){ this.$btnSignin.style.display='none'; }
    this.viewer = new M3DViewer(this.$viewer);
    this.core = new LocimyuCore({ gapi: (window.gapi||null) });
    this.core.addEventListener('glb:url', (e)=>{
      this._log('glb:url 受領 → three.jsへ');
      this._busy(true, 'GLB表示中…');
      this.viewer.loadObjectURL(e.detail.objectUrl).then(()=>{
        this._busy(false);
        this._log('modelLoaded');
        this.core.resolvePinSpreadsheet().then((res)=>{
          if (res){ this._log('シート自動解決: '+res.name+' ('+res.sheetId+')'); this._busy(true, 'ピン読込中…'); return this.core.loadPins(res.sheetId); }
        }).then(()=>{ this._busy(false); }).catch((err)=>{ this._busy(false); this._log('解決/読込エラー: '+(err&&err.message?err.message:String(err))); });
      }).catch((err)=>{ this._busy(false); this._log('GLB表示エラー: '+(err&&err.message?err.message:String(err))); });
    });
    this.core.addEventListener('pins:loaded', (e)=>{ this.pins = e.detail.pins || []; this._renderList(); });
    this.core.addEventListener('error', (e)=>{ const err=e.detail; this._log('ERROR: '+(err&&err.message?err.message:String(err))); });
  }
  _onSignin(){
    try{
      if (window.google && google.accounts && google.accounts.oauth2){
        const client = google.accounts.oauth2.initTokenClient({
          client_id: (window.__LOCIMYU_CLIENT_ID__||''),
          scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.metadata.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
          callback: (t)=>{ this._log('Token acquired'); }
        });
        client.requestAccessToken();
      }else{
        this._log('トークン取得：google.accounts が未ロード。既存セッションを利用します。');
      }
    }catch(e){ this._log('サインインエラー: '+(e&&e.message?e.message:String(e))); }
  }
  _onLoad(){
    const val = (this.$input.value||'').trim();
    if (!val){ this._log('GLBのURLまたはIDを入力してください'); return; }
    this._busy(true, 'GLBダウンロード中…');
    this.core.loadGLB(val).then(()=>{ this._busy(false); }).catch((e)=>{
      this._busy(false);
      this._log('GLB読込エラー: '+(e&&e.message?e.message:String(e)));
      alert((e&&e.message)?e.message:String(e));
    });
  }
  _toggleView(){
    const p = new URLSearchParams(location.search);
    const v = (p.get('view')==='1') ? null : '1';
    if (v===null) p.delete('view'); else p.set('view','1');
    const q = p.toString(); const url = location.pathname + (q?('?'+q):'');
    location.assign(url);
  }
  _renderList(){
    const root = this.$list;
    if (!this.pins || !this.pins.length){ root.textContent = 'ピンがありません'; return; }
    const frag = document.createDocumentFragment();
    for (let i=0;i<this.pins.length;i++){
      const p = this.pins[i];
      const row = document.createElement('div'); row.className='row';
      row.textContent = (p.title||('Pin '+(i+1))) + (p.body?(' — '+p.body):'');
      row.addEventListener('click', ()=> this._onSelectPin(p, i));
      frag.appendChild(row);
    }
    root.innerHTML=''; root.appendChild(frag);
  }
  _onSelectPin(p, i){
    this.$detail.innerHTML = '';
    const t = document.createElement('div'); t.style.fontWeight='700'; t.style.marginBottom='6px'; t.textContent = p.title || ('Pin '+(i+1));
    const b = document.createElement('div'); b.textContent = p.body || '';
    const img = document.createElement('img'); img.style.maxWidth='100%'; img.style.maxHeight='160px'; img.style.display='block'; img.style.marginTop='6px';
    if (p.img){ img.src = p.img; } else { img.alt='画像が設定されていません'; img.style.opacity='0.6'; }
    this.$detail.appendChild(t); this.$detail.appendChild(b); this.$detail.appendChild(img);
    try{ if (typeof window.selectPin === 'function') window.selectPin(p.id||p._row||i); }catch(_){}
  }
  _log(m){
    const d = document.createElement('div'); d.textContent = '['+(new Date().toLocaleTimeString())+'] '+m;
    this.$log.appendChild(d); this.$hud.scrollTop = this.$hud.scrollHeight;
  }
  _busy(on, msg){
    this.$busy.style.display = on ? 'flex' : 'none';
    if (on && msg) this.$busyMsg.textContent = msg;
  }
}
if (!customElements.get('locimyu-app')) customElements.define('locimyu-app', LocimyuApp);
