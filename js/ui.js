export function setupTabs(){
  const btns = Array.from(document.querySelectorAll('.tab-btn'));
  const tabs = new Map(Array.from(document.querySelectorAll('.tab')).map(el=>[el.id.replace('tab-',''), el]));
  const show = (key)=>{
    btns.forEach(b=> b.classList.toggle('active', b.dataset.tab===key));
    tabs.forEach((el,name)=> el.classList.toggle('active', name===key));
  };
  btns.forEach(b=> b.addEventListener('click', ()=> show(b.dataset.tab)));
  // mobile footer buttons
  const click = (key)=> show(key);
  document.getElementById('mobileHome').onclick = ()=>click('home');
  document.getElementById('mobileMaterials').onclick = ()=>click('materials');
  document.getElementById('mobileCamera').onclick = ()=>click('camera');
  document.getElementById('mobileCaptions').onclick = ()=>click('captions');
  show('home');
}

export function setLoading(on){
  document.getElementById('loadingOverlay').classList.toggle('hidden', !on);
}

export function toast(msg){
  console.log('[LociMyu]', msg);
}
