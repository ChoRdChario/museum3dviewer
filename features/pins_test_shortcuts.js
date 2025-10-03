// features/pins_test_shortcuts.js
// Optional: simple shortcuts to validate the bridge without viewer wiring.
// Shift + A : add dummy pin at (0,0,0)
// Shift + O : show overlay with last pin

import { saveNewPin, decoratePin, getPins } from './cloud_pins_bridge.js';

window.addEventListener('keydown', async (e)=>{
  if(!e.shiftKey) return;
  if(e.key.toLowerCase()==='a'){
    const n = getPins().length+1;
    const pin = { id:'', x:0, y:0, z:0, title:`Pin ${n}`, body:`auto-created ${new Date().toLocaleTimeString()}`, imageId:'' };
    await saveNewPin(pin);
  }
  if(e.key.toLowerCase()==='o'){
    const last = getPins().slice(-1)[0];
    if(last){
      const d = await decoratePin(last);
      window.__LMY_overlay?.showOverlay(d);
    }
  }
});
