export function installConflictGuards(){
  const seen=new WeakSet();
  const orig=window.addEventListener;
  window.addEventListener=function(type,fn,opt){
    if(type==='resize'){
      if(seen.has(fn)) return;
      seen.add(fn);
    }
    return orig.call(window,type,fn,opt);
  };
}