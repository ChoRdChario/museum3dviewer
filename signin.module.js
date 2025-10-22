/* LociMyu v6.6 - signin.module.js (P0)
 * Attach click handler to existing single "Sign in" button only.
 * Does not create any new button.
 */
(function(){
  function findSignInButton(){
    // Prefer explicit ids/classes if present
    const byId = document.getElementById("btnSignIn") || document.getElementById("signin") || document.getElementById("sign-in");
    if (byId) return byId;
    const byAttr = document.querySelector('[data-lm-signin], [data-role="signin"], .btn-signin, button.signin');
    if (byAttr) return byAttr;
    // Fallback: match visible button with text "Sign in"
    const candidates = Array.from(document.querySelectorAll('button, .button, [role="button"]'));
    const got = candidates.find(el => /\bsign\s*in\b/i.test(el.textContent || ""));
    return got || null;
  }

  function attach(){
    const btn = findSignInButton();
    if (!btn) {
      console.warn("[signin] Sign in button not found");
      return;
    }
    if (btn.__lm_bound) return;
    btn.__lm_bound = true;
    btn.addEventListener("click", async (ev)=>{
      ev.preventDefault();
      try{
        if (window.LM_GAuth && LM_GAuth.ensureToken) {
          await LM_GAuth.ensureToken(/*force*/true);
          console.log("[signin] token ok");
        } else {
          console.error("[signin] LM_GAuth missing");
        }
      }catch(e){
        console.error("[signin] ensureToken failed", e);
      }
    }, {passive:false});
    console.log("[signin] attached to", btn);
  }

  window.LM_SignIn = { attach };
})();
