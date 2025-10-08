// pins.js
const COLORS = ['#8aa7ff','#e9ce57','#80c77a','#b784f5','#6a88a1','#7272ff','#c96a8a','#90a0ff'];

export function setupPins(opts){
  const qs = s=>document.querySelector(s);
  const elList   = qs(opts.capList);
  const elTitle  = qs(opts.capTitle);
  const elBody   = qs(opts.capBody);
  const elPal    = qs(opts.pinPalette);
  const elFilter = qs(opts.pinFilter);
  const btnAdd   = qs(opts.btnAdd);
  const btnRef   = qs(opts.btnRefresh);

  if(!elList||!elTitle||!elBody||!elPal||!elFilter||!btnAdd){
    console.warn('[pins] required elements missing');
    return;
  }

  // palette
  elPal.innerHTML = '';
  COLORS.forEach((c,i)=>{
    const b = document.createElement('button');
    b.className = 'color';
    b.style.background = c;
    if (i===0) b.classList.add('is-active');
    b.addEventListener('click', ()=>{
      elPal.querySelectorAll('.color').forEach(x=>x.classList.remove('is-active'));
      b.classList.add('is-active');
      currentColor = c;
    });
    elPal.appendChild(b);
  });

  // filters
  const filterColors = elFilter.querySelector('#filterColors');
  const all = elFilter.querySelector('#filterAll');
  filterColors.innerHTML = '';
  COLORS.forEach((c)=>{
    const label = document.createElement('label');
    label.className = 'check';
    const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true;
    const dot = document.createElement('span');
    dot.className = 'color'; dot.style.background = c;
    label.append(cb, dot);
    filterColors.appendChild(label);
    cb.addEventListener('change', ()=>applyFilter());
  });
  all.addEventListener('change', ()=>{
    filterColors.querySelectorAll('input[type=checkbox]').forEach(cb=>cb.checked = all.checked);
    applyFilter();
  });

  // list
  elList.innerHTML = '';
  let model = []; // {id,title,body,color}

  let currentColor = COLORS[0];

  function applyFilter(){
    renderList();
  }

  function renderList(){
    elList.innerHTML = '';
    const allowed = new Set();
    const boxes = filterColors.querySelectorAll('input[type=checkbox]');
    COLORS.forEach((c,i)=>{ if (boxes[i].checked) allowed.add(c); });

    model.forEach((cap)=>{
      if (!allowed.has(cap.color)) return;
      const row = document.createElement('div');
      row.className = 'item';
      const dot = document.createElement('span'); dot.className='dot'; dot.style.background=cap.color;
      const title = document.createElement('div'); title.className='title'; title.textContent = cap.title || '(untitled)';
      const del = document.createElement('button'); del.className='del'; del.textContent='Delete';
      del.addEventListener('click', ()=>{
        model = model.filter(x=>x.id!==cap.id);
        renderList();
      });
      row.append(dot,title,del);
      row.addEventListener('click', ()=> select(cap.id));
      elList.appendChild(row);
    });
  }

  function select(id){
    const item = model.find(x=>x.id===id);
    if (!item) return;
    elTitle.value = item.title || '';
    elBody.value  = item.body || '';
  }

  btnAdd.addEventListener('click', ()=>{
    const cap = {
      id: crypto.randomUUID(),
      title: elTitle.value.trim(),
      body: elBody.value.trim(),
      color: currentColor
    };
    model.push(cap);
    elTitle.value = '';
    elBody.value = '';
    renderList();
  });

  if (btnRef){
    btnRef.addEventListener('click', ()=>{
      // 後で Drive 画像一覧リフレッシュに接続
      console.log('[pins] refresh images requested');
    });
  }

  renderList();
}
