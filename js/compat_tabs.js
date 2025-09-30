// compat_tabs.js — ui.js の setupTabs() が期待するIDを補完
(function(){
  const q  = (sel)=>document.querySelector(sel);
  const setId = (el,id)=>{ if(el && !document.getElementById(id)) el.id = id; return el; };

  // 既存ボタンに ID を付与
  setId(q('.tab-btn[data-tab="captions"]'),  'tabCaptionsBtn');
  setId(q('.tab-btn[data-tab="materials"]'), 'tabMaterialsBtn');
  setId(q('.tab-btn[data-tab="camera"]'),    'tabCameraBtn');

  // Home ボタンが無ければ Captions をクローンして用意
  if(!document.getElementById('tabHomeBtn')){
    const src = q('.tab-btn[data-tab="captions"]');
    if(src && src.parentNode){
      const clone = src.cloneNode(true);
      clone.id = 'tabHomeBtn';
      clone.dataset.tab = 'home';
      clone.textContent = 'ホーム';
      src.parentNode.insertBefore(clone, src);
    }
  }

  // セクションIDを ui.js 互換に
  const map = [
    ['#tab-captions','tabCaptions'],
    ['#tab-materials','tabMaterials'],
    ['#tab-camera','tabCamera']
  ];
  for(const [sel,newId] of map){
    const el = q(sel);
    if(el && !document.getElementById(newId)) el.id = newId;
  }

  // Home セクションが無ければダミーを置く（キャプションの別名）
  if(!document.getElementById('tabHome')){
    const cap = document.getElementById('tabCaptions');
    if(cap && cap.parentNode){
      const alias = document.createElement('section');
      alias.id = 'tabHome';
      alias.className = cap.className;
      alias.style.display = 'none';
      cap.parentNode.insertBefore(alias, cap);
    }
  }
})();