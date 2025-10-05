// probe_viewer_visibility.js (ESM)
import { ensureDemo } from './fallback_viewer_bootstrap.js';
(async ()=>{
  try{
    console.log('[probe] start');
    await ensureDemo();
  }catch(err){
    console.warn('[probe] demo mount failed', err);
  }
})();
