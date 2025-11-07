(function(){
  const TAG='[cap-ui v2]';
  const log=(...a)=>console.log(TAG,...a);
  const warn=(...a)=>console.warn(TAG,...a);

  // Find caption pane
  const pane = document.querySelector('#pane-caption.pane') || document.getElementById('pane-caption');
  if(!pane){
    return warn('pane-caption not found; abort');
  }

  // Ensure root container
  let root = pane.querySelector('#caption-root');
  if(!root){
    root = document.createElement('div');
    root.id = 'caption-root';
    pane.appendChild(root);
    log('created #caption-root');
  } else {
    log('#caption-root present');
  }

  // Helper: create element with attributes
  const el = (tag, attrs={}, text='') => {
    const n = document.createElement(tag);
    Object.entries(attrs).forEach(([k,v])=>{
      if (k === 'class') n.className = v;
      else if (k === 'for') n.htmlFor = v;
      else n.setAttribute(k,v);
    });
    if (text) n.textContent = text;
    return n;
  };

  // Expected structure definitions (IDs only; styles are provided by existing CSS)
  const expected = [
    'pinColorRow',
    'filterRow',
    'captionList',
    'titleBodyRow',
    'imageStripRow'
  ];

  // Build missing blocks minimally
  const ensureBlocks = () => {
    // Pin color row
    if(!root.querySelector('#pinColorRow')){
      const row = el('div', {id:'pinColorRow'});
      const label = el('div', {class:'subtle'}, 'Pin color');
      const chips = el('div', {id:'pinColorChips'});
      // 10 sample color chips (UI script may re-render later)
      const colors = ['#ffb84d','#ffd966','#ffe599','#cfe2f3','#b4a7d6','#d5a6bd','#f4cccc','#a2c4c9','#b6d7a8','#ead1dc'];
      colors.forEach((c,i)=>{
        const b = el('button', {type:'button', class:'chip', 'data-color':c, title:c});
        b.style.width='18px'; b.style.height='18px'; b.style.borderRadius='999px'; b.style.border='1px solid rgba(255,255,255,.2)'; b.style.marginRight='6px'; b.style.background=c;
        chips.appendChild(b);
      });
      row.appendChild(label);
      row.appendChild(chips);
      root.appendChild(row);
      log('built pinColorRow');
    }
    // Filter row
    if(!root.querySelector('#filterRow')){
      const row = el('div',{id:'filterRow'});
      const label = el('div', {class:'subtle'}, 'Filter');
      const controls = el('div', {id:'filterControls'});
      controls.appendChild(el('button',{id:'filterAll',type:'button',class:'btn-xs'},'All'));
      controls.appendChild(el('button',{id:'filterNone',type:'button',class:'btn-xs'},'None'));
      const colors = ['peach','lemon','mint','sky','violet','lav','pink','teal','lime','rose'];
      const colorWrap = el('span',{id:'filterColors'});
      colors.forEach((name,i)=>{
        const b = el('button',{type:'button',class:'chip', 'data-tag':name, title:name});
        b.style.width='18px'; b.style.height='18px'; b.style.borderRadius='999px'; b.style.border='1px solid rgba(255,255,255,.2)'; b.style.marginLeft='6px';
        colorWrap.appendChild(b);
      });
      controls.appendChild(colorWrap);
      row.appendChild(label);
      row.appendChild(controls);
      root.appendChild(row);
      log('built filterRow');
    }
    // Caption list
    if(!root.querySelector('#captionList')){
      const list = el('div',{id:'captionList', style:'min-height:180px; border:1px solid rgba(255,255,255,.08); border-radius:8px; padding:6px; overflow:auto;'});
      root.appendChild(list);
      log('built captionList');
    }
    // Title / Body
    if(!root.querySelector('#titleBodyRow')){
      const wrap = el('div',{id:'titleBodyRow', style:'margin-top:8px;'});
      const title = el('input',{id:'capTitle', type:'text', placeholder:'Title'});
      const body = el('textarea',{id:'capBody', placeholder:'Body', rows:'4', style:'margin-top:6px;'});
      wrap.appendChild(title); wrap.appendChild(body);
      root.appendChild(wrap);
      log('built title/body');
    }
    // Image strip
    if(!root.querySelector('#imageStripRow')){
      const wrap = el('div',{id:'imageStripRow', style:'margin-top:8px;'});
      const btn = el('button',{id:'btnRefreshImages', type:'button', class:'btn-sm'}, 'Refresh images');
      const strip = el('div',{id:'imageStrip', style:'margin-top:6px; display:flex; gap:8px; flex-wrap:wrap;'});
      wrap.appendChild(btn); wrap.appendChild(strip);
      root.appendChild(wrap);
      log('built image strip row');
    }
  };

  ensureBlocks();
})();