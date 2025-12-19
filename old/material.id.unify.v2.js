/* material.id.unify.v2.js
 * Anchor parents for material select/range strictly inside the Per‑material opacity card.
 * Creates dedicated slots if missing.
 */
(function(){
  const TAG='[mat-id-unify v2]';
  const qs=(s,r=document)=>r.querySelector(s);

  function ensureSlots(){
    const card = qs('#pm-opacity') || (function(){
      const host = qs('#panel-material') || qs('#pane-material') || qs('.lm-panel-material');
      if (!host) return null;
      const sec = document.createElement('section');
      sec.id='pm-opacity';
      sec.className='pm-card card';
      sec.innerHTML=`
        <div class="pm-title">Per-material opacity (saved per sheet)</div>
        <div class="pm-row"><div class="pm-slot-select"></div><div id="pm-value" class="small" style="margin-left:auto;">1.00</div></div>
        <div class="pm-row"><div class="pm-slot-range" style="width:100%"></div></div>`;
      host.prepend(sec);
      return sec;
    })();
    if (!card) return null;
    if (!qs('.pm-slot-select', card)){
      const row=document.createElement('div');
      row.className='pm-row';
      row.innerHTML=`<div class="pm-slot-select"></div><div id="pm-value" class="small" style="margin-left:auto;">1.00</div>`;
      card.prepend(row);
    }
    if (!qs('.pm-slot-range', card)){
      const row2=document.createElement('div');
      row2.className='pm-row';
      row2.innerHTML=`<div class="pm-slot-range" style="width:100%"></div>`;
      card.appendChild(row2);
    }
    return card;
  }

  const card = ensureSlots();
  if (!card){ console.warn(TAG,'card not found'); return; }

  // expose target containers for other modules
  window.__LM_MAT_ANCHORS = {
    selectParent: card.querySelector('.pm-slot-select'),
    rangeParent: card.querySelector('.pm-slot-range'),
    valueEl: card.querySelector('#pm-value'),
    card
  };
  console.debug(TAG, 'unified', {selectParent: 'pm-slot-select', rangeParent:'pm-slot-range'});
})();
