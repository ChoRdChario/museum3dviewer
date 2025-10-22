
/* signin.module.js — robust attach to existing Sign in UI */
(function(){
  function looksLikeSignIn(el){
    if (!el) return false;
    if (el.matches('[data-lm-signin], #auth-signin, #signin, #sign-in, .btn-signin, button.signin')) return true;
    const label=(el.getAttribute('aria-label')||'').toLowerCase();
    const text=(el.textContent||'').trim().toLowerCase();
    return /sign\s*in/.test(label) || /^sign\s*in$/.test(text);
  }
  function findBtn(){
    let btn = document.querySelector('[data-lm-signin], #auth-signin, #signin, #sign-in, .btn-signin, button.signin');
    if (btn) return btn;
    const cands = Array.from(document.querySelectorAll('button,a,[role=\"button\"]')).filter(looksLikeSignIn);
    return cands[0] || null;
  }
  function attachOnce(btn){
    if (!btn || btn.__lm_bound) return;
    btn.__lm_bound = true;
    btn.addEventListener(\"click\", async (ev)=>{
      ev.preventDefault();
      try{
        if (window.LM_GAuth && LM_GAuth.ensureToken){ await LM_GAuth.ensureToken(true); console.log(\"[signin] token ok\"); }
        else { console.error(\"[signin] LM_GAuth missing\"); }
      }catch(e){ console.error(\"[signin] ensureToken failed\", e); }
    }, {passive:false});
    console.log(\"[signin] attached to\", btn);
  }
  function attach(){
    const btn = findBtn(); if (btn) attachOnce(btn);
    const mo = new MutationObserver(()=>{ const b=findBtn(); if (b) attachOnce(b); });
    mo.observe(document.documentElement, {subtree:true, childList:true});
  }
  window.LM_SignIn = Object.assign(window.LM_SignIn||{}, { attach });
})();
