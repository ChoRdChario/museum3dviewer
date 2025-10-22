/* signin.module.js — attach to existing Sign in button only */
(function(){
  function findBtn(){
    return document.querySelector('[data-lm-signin]') ||
           document.getElementById('btnSignIn') ||
           document.getElementById('signin') ||
           document.getElementById('sign-in') ||
           document.querySelector('.btn-signin, button.signin');
  }
  function attach(){
    const btn = findBtn();
    if (!btn){ console.warn("[signin] Sign in button not found"); return; }
    if (btn.__lm_bound) return;
    btn.__lm_bound = true;
    btn.addEventListener("click", async (ev)=>{
      ev.preventDefault();
      try{
        if (window.LM_GAuth && LM_GAuth.ensureToken) { await LM_GAuth.ensureToken(true); console.log("[signin] token ok"); }
        else { console.error("[signin] LM_GAuth missing"); }
      }catch(e){ console.error("[signin] ensureToken failed", e); }
    }, {passive:false});
    console.log("[signin] attached to", btn);
  }
  window.LM_SignIn = { attach };
})();
