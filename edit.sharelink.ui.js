// edit.sharelink.ui.js
// Edit-mode only: add a compact "Share" button next to Load.
// Generates a share link: ?mode=share&glb=<fileId> (no sid/gid).

(function(){
  const TAG='[lm-sharelink]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);

  function extractDriveFileId(raw){
    if (!raw) return '';
    const s = String(raw).trim();
    // plain fileId heuristic (Google Drive ids are URL-safe base64-ish)
    if (/^[a-zA-Z0-9_-]{10,}$/.test(s) && !s.includes('/') && !s.includes('http')) return s;
    let m = s.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    m = s.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    m = s.match(/uc\?export=download&id=([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    return '';
  }

  function buildShareUrl(fileId){
    const u = new URL(location.origin + location.pathname);
    u.searchParams.set('mode','share');
    u.searchParams.set('glb', fileId);
    return u.toString();
  }

  async function copyToClipboard(text){
    try{
      if (navigator.clipboard && window.isSecureContext){
        await navigator.clipboard.writeText(text);
        return true;
      }
    }catch(_e){}
    // fallback
    try{
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly','');
      ta.style.cssText='position:fixed;left:-9999px;top:-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    }catch(e){
      warn('copy fallback failed', e);
      return false;
    }
  }

  function ensureButton(){
    const loadBtn = document.getElementById('btnGlb');
    const row = loadBtn && loadBtn.parentElement;
    if (!loadBtn || !row) return null;

    // avoid duplicate
    if (document.getElementById('btnShareLink')) return document.getElementById('btnShareLink');

    const b = document.createElement('button');
    b.id = 'btnShareLink';
    b.type = 'button';
    b.textContent = 'Share';
    b.className = 'mini'; // keep compact if mini style exists
    b.style.minWidth = '72px';
    b.style.paddingLeft = '10px';
    b.style.paddingRight = '10px';
    b.title = 'Copy Share link (read-only)';

    // insert after Load
    row.insertBefore(b, loadBtn.nextSibling);

    return b;
  }

  function getCurrentFileId(){
    const g = (window.__LM_CURRENT_GLB_ID__ || '').trim();
    if (g) return g;
    const inp = document.getElementById('glbUrl');
    return extractDriveFileId(inp && inp.value);
  }

  function wire(){
    const btn = ensureButton();
    if (!btn) return false;

    const refreshEnabled = () => {
      const id = getCurrentFileId();
      btn.disabled = !id;
      btn.dataset.glbId = id || '';
    };

    btn.addEventListener('click', async ()=>{
      const fileId = getCurrentFileId();
      if (!fileId){
        warn('no glb id yet');
        return;
      }
      const url = buildShareUrl(fileId);
      const ok = await copyToClipboard(url);
      const old = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Copy failed';
      setTimeout(()=>{ btn.textContent = old; }, 1200);
      log('share link', url);
    });

    // keep state updated
    refreshEnabled();
    setInterval(refreshEnabled, 400);

    return true;
  }

  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=>{ wire(); }, { once:true });
  }else{
    wire();
  }
})(); 
