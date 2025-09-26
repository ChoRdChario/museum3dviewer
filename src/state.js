export function createStore(){
  const ev = new EventTarget();
  const s = { rightPaneWidth: parseInt(localStorage.getItem('m3d:right:w')||'360',10) };
  return {
    get: (k)=> s[k],
    set: (k,v)=>{ s[k]=v; localStorage.setItem('m3d:'+k, String(v)); ev.dispatchEvent(new CustomEvent('change',{detail:{k,v}})); },
    on: (fn)=> ev.addEventListener('change', fn),
    off: (fn)=> ev.removeEventListener('change', fn),
  };
}
