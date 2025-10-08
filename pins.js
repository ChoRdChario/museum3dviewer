/* pins.js — 必須要素の存在チェックを緩和し、UIを生成 */

(function(){
  const qs = (s, r=document)=>r.querySelector(s);
  const qsa = (s, r=document)=>Array.from(r.querySelectorAll(s));
  const log = (...a)=>console.log('[pins]', ...a);

  const COLORS = ['#8fbef5','#e9d176','#8fd17f','#a98fd6','#8290ff','#d97b7b','#9a9fb2','#ffffff'];

  function el(tag, attrs={}, ...kids){
    const x = document.createElement(tag);
    for(const k in attrs){
      if(k==='style' && typeof attrs[k]==='object') Object.assign(x.style, attrs[k]);
      else if(k.startsWith('on') && typeof attrs[k]==='function') x.addEventListener(k.slice(2), attrs[k]);
      else if(attrs[k]!==undefined) x.setAttribute(k, attrs[k]);
    }
    kids.flat().forEach(k=>x.append(k));
    return x;
  }

  function buildColorChips(host){
    host.innerHTML = '';
    COLORS.forEach((c,i)=>{
      const chip = el('div',{class:'chip', style:{background:c}},'');
      chip.title = c;
      chip.addEventListener('click',()=>selectColor(i));
      host.appendChild(chip);
    });
  }

  function buildFilters(host){
    host.innerHTML = '';
    COLORS.forEach((c,i)=>{
      const box = el('input',{type:'checkbox', checked:true});
      box.addEventListener('change',()=>applyFilter());
      host.appendChild(box);
    });
  }

  function buildList(host){
    host.innerHTML = '';
    // 仮：空のリストでも何もしない
  }

  function selectColor(i){
    log('selectColor', i);
  }

  function applyFilter(){
    log('applyFilter');
  }

  function setupPins(){
    const colorsHost = qs('#pinColors');
    const filtersHost = qs('#pinFilters');
    const listHost = qs('#captionList');
    const title = qs('#titleInput');
    const body = qs('#bodyInput');
    const refresh = qs('#refreshImagesBtn');

    // どれか欠けても落とさずログだけ出して続行（既存boot連鎖を止めない）
    if(!colorsHost || !filtersHost || !listHost || !title || !body || !refresh){
      console.warn('[pins] required elements missing');
    }

    if(colorsHost) buildColorChips(colorsHost);
    if(filtersHost) buildFilters(filtersHost);
    if(listHost) buildList(listHost);

    if(refresh) refresh.addEventListener('click', ()=>console.log('[pins] refresh images'));
    return true;
  }

  // 公開
  window.PinsUI = { setup: setupPins };
})();
