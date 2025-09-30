export function installConflictGuards(){
  // Prevent multiple resize handlers clobbering each other
  const seen = new WeakSet();
  const origAdd = window.addEventListener;
  window.addEventListener = function(type, listener, opts){
    if (type === 'resize' && seen.has(listener)) { return; }
    if (type === 'resize') seen.add(listener);
    return origAdd.call(window, type, listener, opts);
  };
}