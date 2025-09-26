export class PinsPane{
  constructor({ i18n, viewMode=false }={}){
    this.i18n = i18n; this.viewMode = viewMode;
    this.el = document.createElement('div');
    this.el.setAttribute('part','pins-pane');
    this.el.innerHTML = this.#html();
    this.sheetEl = this.el.querySelector('.sheet-host');
    this.listEl = this.el.querySelector('.list');
    this.detailEl = this.el.querySelector('.detail');
    this.queryEl = this.el.querySelector('[data-q]');
    this.sortEl = this.el.querySelector('[data-sort]');
    this.fImgEl = this.el.querySelector('[data-fimg]');
    this._pins = [];
    this._filtered = [];
    this._current = null;

    this.el.querySelector('[data-act="search"]').addEventListener('click', ()=> this.#apply());
    this.queryEl.addEventListener('keydown', (e)=>{ if(e.key==='Enter') this.#apply(); });
    this.sortEl.addEventListener('change', ()=> this.#apply());
    this.fImgEl.addEventListener('change', ()=> this.#apply());

    this.el.addEventListener('click', (e)=>{
      const li = e.target.closest('li[data-idx]');
      if (li){ this.#openDetail(parseInt(li.dataset.idx,10)); }
    });
  }

  #html(){
    return `
      <style>
        :host{display:block;height:100%;}
        .host{display:flex;flex-direction:column;height:100%;}
        .ctrl{padding:10px;border-bottom:1px solid var(--m3d-border);display:flex;gap:8px;align-items:center}
        .ctrl input, .ctrl select{background:#0c0e12;border:1px solid var(--m3d-border);color:var(--m3d-fg);border-radius:8px;padding:6px 10px;}
        .list{overflow:auto;flex:1}
        .list ul{list-style:none;margin:0;padding:8px;display:grid;gap:8px}
        .list li{border:1px solid var(--m3d-border);border-radius:12px;padding:10px;background:#12151b;cursor:pointer}
        .list li .t{font-weight:600}
        .list li .b{opacity:.9;font-size:13px;line-height:1.4}
        .list li .g{opacity:.8;font-size:12px}

        .detail{border-top:1px solid var(--m3d-border);padding:10px;height:32%;min-height:160px}
        .detail h3{margin:0 0 8px 0;font-size:15px}
        .detail .img{width:100%;max-height:180px;object-fit:cover;border-radius:10px;border:1px solid var(--m3d-border);background:#0b0d12}
        .ph{border:1px dashed var(--m3d-border);border-radius:10px;padding:16px;text-align:center;color:var(--m3d-sub)}

        .sheet-host{display:none}

        @media (max-width:1023px){
          .sheet-host{display:block}
        }
      </style>
      <div class="host" role="region" aria-label="Pins">
        <div class="ctrl">
          <input data-q placeholder="検索（タイトル・本文）" aria-label="検索" />
          <select data-sort aria-label="並び順">
            <option value="title">タイトル</option>
            <option value="index">作成順</option>
          </select>
          <label style="display:inline-flex;gap:6px;align-items:center"><input type="checkbox" data-fimg />画像あり</label>
          <button data-act="search">適用</button>
        </div>
        <div class="list" role="list"><ul></ul></div>
        <div class="detail" role="region" aria-label="詳細">
          <div class="ph">項目を選択してください</div>
        </div>
        <div class="sheet-host"></div>
      </div>
    `;
  }

  setPins(pins){
    this._pins = Array.isArray(pins) ? pins.slice() : [];
    this.#apply();
  }

  #apply(){
    const q = (this.queryEl.value||'').toLowerCase();
    const s = this.sortEl.value;
    const fimg = this.fImgEl.checked;
    let arr = this._pins.map((p,i)=> ({...p, _index:i}));
    if (q){ arr = arr.filter(p=> (p.title||'').toLowerCase().includes(q) || (p.body||'').toLowerCase().includes(q)); }
    if (fimg){ arr = arr.filter(p=> !!p.img); }
    if (s==='title'){ arr.sort((a,b)=> (a.title||'').localeCompare(b.title||'')); }
    this._filtered = arr;
    this.#renderList();
    this.#renderDetail(this._current);
  }

  #renderList(){
    const ul = this.listEl.querySelector('ul');
    ul.innerHTML = '';
    for (let i=0;i<this._filtered.length;i++){
      const p = this._filtered[i];
      const li = document.createElement('li');
      li.setAttribute('data-idx', String(i));
      li.setAttribute('role','listitem');
      li.innerHTML = `
        <div class="t">${(p.title||'(no title)')}</div>
        <div class="b">${(p.body||'').slice(0,120)}${(p.body||'').length>120?'…':''}</div>
        <div class="g">ID: ${p.id??''}</div>
      `;
      ul.appendChild(li);
    }
  }

  #openDetail(idx){
    this._current = idx;
    this.#renderDetail(idx);
    document.querySelector('locimyu-ui')?.shadowRoot?.querySelector('.sheet')?.classList.add('open');
  }

  #renderDetail(idx){
    const host = this.detailEl;
    if (idx==null || this._filtered[idx]==null){ host.innerHTML = '<div class="ph">項目を選択してください</div>'; return; }
    const p = this._filtered[idx];
    const hasImg = !!p.img;
    const img = hasImg ? `<img class="img" src="${p.img}" alt="image" loading="lazy" />` : `<div class="ph">画像が設定されていません</div>`;
    host.innerHTML = `
      <h3>${p.title||'(no title)'}</h3>
      ${img}
      <div class="body" style="margin-top:8px;white-space:pre-wrap;line-height:1.5">${(p.body||'')}</div>
      ${hasImg?`<div style="margin-top:6px"><a href="${p.img}" target="_blank" rel="noopener">元画像を開く</a></div>`:''}
    `;
  }

  openSheet(mode){
    const ui = document.querySelector('locimyu-ui')?.shadowRoot; if (!ui) return;
    const sheet = ui.querySelector('.sheet');
    const right = ui.querySelector('.right');
    if (!sheet) return;
    right?.classList.remove('open');
    sheet.classList.add('open');
    if (mode==='list') sheet.scrollTop = 0;
  }
}
