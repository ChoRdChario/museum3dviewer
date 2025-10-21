
/**
 * signin.module.js — bind to existing sign-in button only (no DOM injection)
 */
import { bindSignInButton } from "./gauth.module.js";

(function(){
  // Try immediately
  if (!bindSignInButton()) {
    // If button not yet in DOM, retry a few times
    let tries = 0;
    const t = setInterval(()=>{
      if (bindSignInButton()){ clearInterval(t); return; }
      if (++tries > 50) clearInterval(t);
    }, 100);
  }
})();
