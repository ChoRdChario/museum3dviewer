
// museum3dviewer/gauth.js
// Robust SignIn wiring + GIS popup (if available) + UI dedupe + shared token getter.

function $$(sel){ return Array.from(document.querySelectorAll(sel)); }
function pick(selectors){
  for (const s of selectors){
    const el = $$(s).find(e => e && e.offsetParent !== null);
    if (el) return el;
  }
  for (const s of selectors){
    const el = $$(s)[0]; if (el) return el;
  }
  return null;
}
function hideDupes(primary, selectors){
  const all = [...new Set(selectors.flatMap(s => $$(s)))];
  for(const el of all){ if (el !== primary){ el.style.display = 'none'; el.dataset.authDuplicate='1'; } }
}
function makeButton(el){
  if (!el) return;
  if (!['BUTTON'].includes(el.tagName)) el.setAttribute('role','button');
  el.tabIndex = 0; el.style.cursor = 'pointer';
  if (el.tagName === 'BUTTON') el.type = 'button';
}
function labelSign(el, signed){
  if (!el) return;
  const t = signed ? 'Signed in' : 'Sign in';
  if (el.children.length === 0) el.textContent = t;
  el.dataset.authed = signed ? '1':'0';
  if (signed){ el.classList.add('signed'); } else { el.classList.remove('signed'); }
}

export function setupAuth(app, opts={}){
  app.auth = app.auth || {};
  const a = app.auth;
  const selectorsIn  = opts.signinSelectors  || ['#chipSign','#btnSign','[data-role="signin"]','[data-auth="in"]','.signin','.sign-in'];
  const selectorsOut = opts.signoutSelectors || ['#btnSignOut','[data-role="signout"]','[data-auth="out"]','.signout','.sign-out'];

  let btnIn  = pick(selectorsIn);
  let btnOut = pick(selectorsOut);
  hideDupes(btnIn, selectorsIn);
  hideDupes(btnOut, selectorsOut);

  // ===== GIS POPUP (if available) =====
  const CLIENT_ID = opts.clientId || '595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com';
  const SCOPES = opts.scopes || [
    'https://www.googleapis.com/auth/drive.readonly',
    'https://www.googleapis.com/auth/drive.file',
    'https://www.googleapis.com/auth/spreadsheets'
  ].join(' ');

  a.__signed = false;
  a.__token = null;
  a.isSignedIn = a.isSignedIn || (() => a.__signed);
  a.getAccessToken = () => a.__token;

  async function signInStub(){ a.__signed = true; a.__token = null; }
  async function signOutStub(){ a.__signed = false; a.__token = null; }

  // prefer host-provided handlers
  if (!a.signIn || !a.signOut){
    // try GIS
    let tokenClient = null;
    const hasGIS = !!(window.google && google.accounts && google.accounts.oauth2);
    if (hasGIS){
      tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        prompt: '', // will be 'consent' on first interaction
        callback: (resp)=>{
          if (resp && resp.access_token){
            a.__token = resp.access_token;
            a.__signed = true;
            refresh();
          }
        }
      });
      a.signIn = async ()=>{
        // must be called in user gesture
        tokenClient.requestAccessToken({prompt: a.__token ? '' : 'consent'});
      };
      a.signOut = async ()=>{
        try{
          if (a.__token && google.accounts.oauth2.revoke){
            google.accounts.oauth2.revoke(a.__token, ()=>{});
          }
        }catch(_e){}
        a.__token = null; a.__signed = false;
      };
    }else{
      // fallback stub
      a.signIn = signInStub;
      a.signOut = signOutStub;
    }
  }

  function refresh(){
    labelSign(btnIn, a.isSignedIn());
    if (btnOut) btnOut.style.display = a.isSignedIn() ? '' : 'none';
    if (btnIn)  btnIn.style.display  = '';
  }

  function bind(){
    if (btnIn){
      makeButton(btnIn);
      btnIn.onclick = async (e)=>{ e.preventDefault(); await a.signIn(); refresh(); };
    }
    if (btnOut){
      makeButton(btnOut);
      btnOut.onclick = async (e)=>{ e.preventDefault(); await a.signOut(); refresh(); };
    }
  }

  bind(); refresh();

  // Late DOM changes (theme/template rerender)
  const mo = new MutationObserver(()=>{
    const next = pick(selectorsIn);
    if (next && next !== btnIn){
      if (btnIn) btnIn.onclick = null;
      btnIn = next;
      hideDupes(btnIn, selectorsIn);
      bind(); refresh();
    }
  });
  mo.observe(document.body, {childList:true, subtree:true});
}
