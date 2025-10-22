/* signin.module.js — simplified IIFE */
(function(){
  function findBtn(){
    return document.querySelector('[data-lm-signin], #auth-signin, #signin, #sign-in, .btn-signin, button.signin');
  }
  function attachOnce(btn){
    if (!btn || btn.__lm_bound) return;
    btn.__lm_bound = true;
    btn.addEventListener('click', async function(ev){
      ev.preventDefault();
      try{
        if (window.LM_GAuth && LM_GAuth.ensureToken){
          await LM_GAuth.ensureToken(true);
          console.log('[signin] token ok');
        } else {
          console.error('[signin] LM_GAuth missing');
        }
      }catch(e){ console.error('[signin] ensureToken failed', e); }
    }, {passive:false});
    console.log('[signin] attached to', btn);
  }
  function attach(){
    const btn = findBtn(); if (btn) attachOnce(btn);
    const mo = new MutationObserver(function(){ const b = findBtn(); if (b) attachOnce(b); });
    mo.observe(document.documentElement, {subtree:true, childList:true});
  }
  window.LM_SignIn = Object.assign(window.LM_SignIn||{}, { attach });
})();