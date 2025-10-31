/* LociMyu material.orchestrator.js
 * VERSION_TAG: V6_12k_PANEL_INJECT
 * Safe, drop-in file focused on populating the right-panel material select.
 * It does not hard-depend on other modules; it no-ops if bridges are absent.
 */
(function(){
  var NS = '[mat-orch]';

  function log(){ try{ console.log.apply(console, arguments); }catch(_){ } }
  function warn(){ try{ console.warn.apply(console, arguments); }catch(_){ } }

  // ---- bridge/sheet context logging (non-invasive) ---------------------------
  try {
    window.addEventListener('lm:sheet-context', function(ev){
      var d = (ev && ev.detail) || {};
      log(NS, 'sheet context set', d);
    });
  } catch(_){}

  // ---- material listing sources ---------------------------------------------
  function listFromBridge(){
    try{
      var b = window.viewerBridge;
      if (b && typeof b.listMaterials === 'function'){
        var arr = b.listMaterials() || [];
        if (Array.isArray(arr)) return arr.slice();
      }
    }catch(_){}
    return [];
  }
  function listFromDiag(){
    var dbg = document.querySelector('#lm-material-select');
    if (!dbg || !dbg.options) return [];
    var out = [];
    for (var i=0;i<dbg.options.length;i++){
      var v = dbg.options[i].value || dbg.options[i].textContent || '';
      if (!v) continue;
      out.push(v);
    }
    // drop placeholder
    if (out.length && /select/i.test(out[0])) out.shift();
    return out;
  }
  function getMaterials(){
    var b = listFromBridge();
    if (b.length) return b;
    return listFromDiag();
  }

  // ---- panel/section lookup --------------------------------------------------
  function getRightPanel(){
    return document.querySelector('[data-lm="right-panel"]')
        || document.querySelector('#right-panel')
        || document.querySelector('#panel')
        || document.body;
  }
  function findOpacityCard(){
    var panel = getRightPanel();
    if (!panel) return document.body;
    var divs = panel.querySelectorAll('div');
    var best = null;
    for (var i=0;i<divs.length;i++){
      var d = divs[i];
      var txt = (d.innerText || '').toLowerCase();
      if (!txt) continue;
      if (txt.indexOf('per-material opacity') >= 0 || txt.indexOf('select material') >= 0){
        if (d.querySelector('input[type="range"]')) { best = d; break; }
        best = best || d;
      }
    }
    return best || panel;
  }
  function findPanelSelect(card){
    if (!card) return null;
    var sel = card.querySelector('[data-lm="material-select"]')
           || card.querySelector('#material-select')
           || card.querySelector('select[name="material"]');
    if (sel) return sel;

    // Text-nearby fallback
    var nodes = card.querySelectorAll('div,label,span,p');
    for (var i=0;i<nodes.length;i++){
      var t = (nodes[i].textContent || '').toLowerCase();
      if (!t) continue;
      if (t.indexOf('select material') >= 0 || t === 'select'){
        var s = nodes[i].parentElement && nodes[i].parentElement.querySelector('select');
        if (s) return s;
      }
    }
    // Empty select candidate
    var all = card.querySelectorAll('select');
    for (var j=0;j<all.length;j++){
      var s2 = all[j];
      if (s2.id === 'lm-material-select') continue; // exclude diag select
      if (!s2.options || s2.options.length <= 1) return s2;
    }
    return null;
  }
  function ensurePanelSelect(card){
    var sel = findPanelSelect(card);
    if (sel) return sel;
    var wrap = document.createElement('div');
    wrap.style.cssText = 'margin:6px 0 10px 0';
    var lab = document.createElement('div');
    lab.textContent = 'Select material';
    lab.style.cssText = 'font-size:12px;opacity:.7;margin-bottom:4px;';
    sel = document.createElement('select');
    sel.setAttribute('data-lm','material-select');
    sel.style.width = '100%';
    wrap.appendChild(lab);
    wrap.appendChild(sel);
    card.prepend(wrap);
    return sel;
  }

  function cleanupDiagSelect(){
    var dbg = document.querySelector('#lm-material-select');
    if (!dbg) return;
    var panel = getRightPanel();
    if (panel && !panel.contains(dbg)) dbg.remove();
  }

  // ---- populate core ---------------------------------------------------------
  function populatePanelSelect(){
    var materials = getMaterials();
    if (!materials.length){
      warn(NS, '[mat-orch-hotfix] materials still empty after retries (non-fatal)');
      return false;
    }
    var card = findOpacityCard();
    var dst  = ensurePanelSelect(card);
    if (!dst){
      warn(NS, 'panel select not found');
      return false;
    }
    while (dst.firstChild) dst.removeChild(dst.firstChild);
    var add = function(v,t){ var o=document.createElement('option'); o.value=v; o.textContent=t||v; dst.appendChild(o); };
    add('','-- Select --');
    for (var i=0;i<materials.length;i++) add(materials[i], materials[i]);
    dst.value = '';
    try { dst.dispatchEvent(new Event('change', {bubbles:true})); } catch(_){}
    cleanupDiagSelect();
    log(NS, 'populated into panel select:', materials.length);
    return true;
  }

  // ---- triggers --------------------------------------------------------------
  try { window.addEventListener('lm:scene-ready', function(){ setTimeout(populatePanelSelect, 0); }); } catch(_){}
  try { window.addEventListener('lm:sheet-context', function(){ setTimeout(populatePanelSelect, 0); }); } catch(_){}
  (function hookTab(){
    try{
      var btn = document.querySelector('[data-lm="tab-material"]') || document.querySelector('#tab-material');
      if (btn){
        btn.addEventListener('click', function(){ setTimeout(populatePanelSelect, 0); });
        return;
      }
      document.addEventListener('click', function(ev){
        var t = ev && ev.target;
        if (!t) return;
        var txt = (t.textContent||'').trim().toLowerCase();
        if (txt === 'material') setTimeout(populatePanelSelect, 0);
      });
    }catch(_){}
  })();

  // initial retries
  (function retry(i){
    if (populatePanelSelect()) return;
    if (i > 10) return;
    setTimeout(function(){ retry(i+1); }, 250);
  })(0);

  log(NS, 'loaded VERSION_TAG:V6_12k_PANEL_INJECT');
})();
