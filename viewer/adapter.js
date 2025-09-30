import { bus } from '../core/bus.js';
export function createViewerAdapter({ canvas }){
  const state = { mode:'persp', width:canvas.clientWidth||800, height:canvas.clientHeight||600, zoom:1, v0:1 };
  const api = {
    canvas,
    setOrtho(on){
      state.mode = on ? 'ortho' : 'persp';
      if (on && !state.v0) state.v0 = 1;
      bus.emit('viewer:mode', state.mode);
      api.resize();
    },
    resize(){
      const w = canvas.clientWidth || 800;
      const h = canvas.clientHeight || 600;
      state.width=w; state.height=h;
      if (state.mode==='ortho'){
        const aspect = Math.max(0.0001, w/Math.max(1,h));
        const halfV = (state.v0||1)/Math.max(0.0001, state.zoom||1);
        // projection params kept inside; in real impl, set camera.left/right/top/bottom
        state._proj = { left:-halfV*aspect, right:halfV*aspect, top:halfV, bottom:-halfV };
      }
      bus.emit('viewer:resized', {w,h,mode:state.mode});
    },
    raycastAt(x,y){
      // stub: return ground plane hit
      return { point: {x:0,y:0,z:0} };
    }
  };
  window.addEventListener('resize', ()=> api.resize());
  setTimeout(()=>api.resize(),0);
  return api;
}