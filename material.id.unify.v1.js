// material.id.unify.v1.js  v1.7 (robust, idempotent)
(function () {
  try {
    const panel = document.querySelector('#panel-material');
    if (!panel) { console.warn('[mat-id-unify] panel not found'); return; }

    // Heuristic: pick the section that contains a range slider and mentions "opacity"
    const sections = Array.from(panel.querySelectorAll('section, fieldset, div'));
    const opacitySection = sections.find(el => {
      const hasRange = !!el.querySelector('input[type="range"]');
      const txt = (el.textContent || '').toLowerCase();
      return hasRange && txt.includes('opacity');
    });

    if (!opacitySection) { console.warn('[mat-id-unify] opacity section not found'); return; }

    // Dropdown (first select inside the section)
    const dd = opacitySection.querySelector('select');
    if (dd && !dd.id) dd.id = 'pm-material';

    // Range slider
    let range = opacitySection.querySelector('input[type="range"]');
    if (range && !range.id) range.id = 'pm-opacity';

    // Numeric readout (span placed after the range). Create if missing.
    let value = opacitySection.querySelector('#pm-opacity-value, [data-lm="pm-opacity-value"], output, .pm-opacity-value');
    if (!value) {
      value = document.createElement('span');
      value.id = 'pm-opacity-value';
      value.style.marginLeft = '8px';
      if (range && range.parentElement) range.parentElement.appendChild(value);
      else opacitySection.appendChild(value);
    } else if (!value.id) value.id = 'pm-opacity-value';

    console.log('[mat-id-unify v1.7] unified', { dd: !!dd, range: !!range, value: !!value });
  } catch (e) {
    console.warn('[mat-id-unify] error', e);
  }
})();
