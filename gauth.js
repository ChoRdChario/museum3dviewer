// gauth.js — De-duplicate & wire Sign in/out controls with late-DOM support
// Public API: setupAuth(app, opts?)
//  - opts.primarySelectors: candidate selectors in priority order
//  - opts.createIfMissing: default false (we no longer auto-insert a chip)

function qsa(sel){ return Array.from(document.querySelectorAll(sel)); }
function uniq(arr){ return Array.from(new Set(arr)); }

function pickPrimary(selectors){
  for (const sel of selectors){
    const match = qsa(sel).find(el => el && el.offsetParent !== null);
    if (match) return match;
  }
  // if nothing visible, still return first present element
  for (const sel of selectors){
    const match = qsa(sel)[0];
    if (match) return match;
  }
  return null;
}

function markButton(el){
  if (!el) return;
  if (el.tagName === 'A' || el.tagName === 'DIV' || el.tagName === 'SPAN'){
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
  }
  // prevent forms from submitting
  if (el.tagName === 'BUTTON') el.type = 'button';
  el.style.cursor = 'pointer';
  // make sure clicks don't get eaten by parent
  el.addEventListener('click', ev => { ev.stopPropagation(); }, {capture:true});
}

function labelSignIn(el, signed){
  if (!el) return;
  const t = signed ? 'Signed in' : 'Sign in';
  // Don't clobber child icons; replace only textContent if it's simple
  if (el.children.length === 0){ el.textContent = t; }
  el.dataset.authed = signed ? '1' : '0';
  el.style.background = signed ? '#114d2d' : '';
  el.style.color = signed ? '#e8fff3' : '';
}

export function setupAuth(app, opts={}){
  app.auth = app.auth || {};
  const a = app.auth;

  // host may provide real handlers; otherwise stubs
  a.isSignedIn = a.isSignedIn || (() => !!a.__signed);
  a.signIn  = a.signIn  || (async ()=>{ a.__signed = true; });
  a.signOut = a.signOut || (async ()=>{ a.__signed = false; });

  const selectors = opts.primarySelectors || [
    '#chipSign', '#btnSign', '[data-role="signin"]', '[data-auth="in"]', '.signin', '.sign-in'
  ];
  const selOut = ['#btnSignOut', '[data-role="signout"]', '[data-auth="out"]', '.signout', '.sign-out'];

  let inBtn = pickPrimary(selectors);
  let outBtn = pickPrimary(selOut);

  // Hide duplicates to avoid double buttons
  const dupesIn = uniq(selectors.flatMap(s => qsa(s))).filter(el => el && el !== inBtn);
  dupesIn.forEach(el => { el.style.display = 'none'; el.dataset.authDuplicate = '1'; });

  // Same for signout
  const dupesOut = uniq(selOut.flatMap(s => qsa(s))).filter(el => el && el !== outBtn);
  dupesOut.forEach(el => { el.style.display = 'none'; el.dataset.authDuplicate = '1'; });

  function refresh(){
    const signed = !!a.isSignedIn();
    labelSignIn(inBtn, signed);
    if (outBtn){
      outBtn.style.display = signed ? '' : 'none';
    }
    if (inBtn){
      inBtn.style.display = ''; // always show primary
    }
  }

  function bind(){
    if (inBtn){
      markButton(inBtn);
      inBtn.onclick = async (e)=>{
        e.preventDefault();
        try{ await a.signIn(); } finally{ refresh(); }
      };
    }
    if (outBtn){
      markButton(outBtn);
      outBtn.onclick = async (e)=>{
        e.preventDefault();
        try{ await a.signOut(); } finally{ refresh(); }
      };
    }
  }

  bind(); refresh();

  // Observe DOM in case host injects another chip later (e.g., theme switch)
  const mo = new MutationObserver((_list)=>{
    const newPrimary = pickPrimary(selectors);
    if (newPrimary && newPrimary !== inBtn){
      // move binding to the new one and hide old
      if (inBtn){ inBtn.style.display = 'none'; inBtn.onclick = null; }
      inBtn = newPrimary;
      bind(); refresh();
    }
    // Ensure duplicates stay hidden
    uniq(selectors.flatMap(s => qsa(s))).forEach(el => {
      if (el !== inBtn){ el.style.display = 'none'; }
    });
  });
  mo.observe(document.body, {childList: true, subtree: true});

  // Expose small event for host code if needed
  a.__refreshUI = refresh;
}
