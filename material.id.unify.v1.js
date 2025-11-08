// material.id.unify.v1.js  v1.6 (always-on, safe)
(function () {
  try {
    const panel = document.querySelector('#panel-material');
    if (!panel) { console.warn('[mat-id-unify] panel not found'); return; }

    // Find the "Per‑material opacity" section robustly
    const opacitySection = Array.from(panel.querySelectorAll('section,fieldset,div'))
      .find(el => /Per\s*-\s*material\s*opacity/i.test(el.textContent || ''));

    if (!opacitySection) { console.warn('[mat-id-unify] opacity section not found'); return; }

    // Dropdown
    const dd = opacitySection.querySelector('select');
    if (dd && !dd.id) dd.id = 'pm-material';

    // Range (prefer inside section; fall back to any in panel)
    let range = opacitySection.querySelector('input[type="range"]');
    if (!range) {
      range = panel.querySelector('section input[type="range"], fieldset input[type="range"]');
    }
    if (range && !range.id) range.id = 'pm-opacity-range';

    // Value display
    let value = opacitySection.querySelector('#pm-opacity-value, [data-lm="pm-opacity-value"], output, .value, .pm-opacity-value');
    if (!value) {
      value = document.createElement('span');
      value.id = 'pm-opacity-value';
      value.style.marginLeft = '8px';
      if (range && range.parentElement) range.parentElement.appendChild(value);
      else opacitySection.appendChild(value);
    } else if (!value.id) value.id = 'pm-opacity-value';

    console.log('[mat-id-unify v1.6] unified', { dd: !!dd, range: !!range, value: !!value });
  } catch (e) {
    console.warn('[mat-id-unify] error', e);
  }
})();
