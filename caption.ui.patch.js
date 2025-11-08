/* caption.ui.patch.js
 * Restores the Caption tab DOM scaffold that app scripts expect.
 * Non-invasive: if elements already exist, it does nothing.
 * Logs with [cap-ui].
 */
(() => {
  const TAG='[cap-ui]';
  const log=(...a)=>console.log(TAG, ...a);
  const warn=(...a)=>console.warn(TAG, ...a);
  const $ = (sel, root=document) => root.querySelector(sel);

  const pane = $('#pane-caption') || $('#paneCaption') || document.querySelector('section.pane#pane-caption');
  if (!pane) { warn('pane-caption not found'); return; }

  if (pane.dataset.capUiReady === '1') { log('caption-root already present'); return; }

  // ---------- Layout ----------
  // Pin color row
  let colorRow = $('#pinColorRow', pane);
  if (!colorRow) {
    colorRow = document.createElement('div');
    colorRow.id = 'pinColorRow';
    colorRow.className = 'row pin-color-row';
    pane.appendChild(colorRow);
    const colors = ['#f5c07a','#ffb347','#ffd166','#a3d9a5','#8ad0ff','#cbb2ff','#ffaccb','#ffd6a5','#caffbf','#bdbdbd'];
    colors.forEach((c,i)=>{
      const b=document.createElement('button');
      b.type='button'; b.className='chip chip-color'; b.style.background=c; b.title=`color-${i+1}`;
      colorRow.appendChild(b);
    });
    log('built pinColorRow');
  }

  // Filter row
  let filterRow = $('#filterRow', pane);
  if (!filterRow) {
    filterRow = document.createElement('div');
    filterRow.id = 'filterRow';
    filterRow.className = 'row filter-row';
    pane.appendChild(filterRow);

    const allBtn = document.createElement('button');
    allBtn.id='filterAll'; allBtn.textContent='All'; allBtn.type='button'; allBtn.className='btn btn-xs';
    const noneBtn = document.createElement('button');
    noneBtn.id='filterNone'; noneBtn.textContent='None'; noneBtn.type='button'; noneBtn.className='btn btn-xs';
    filterRow.append(allBtn, noneBtn);

    const chips = document.createElement('div');
    chips.id='filterColors';
    chips.className='chip-row';
    for (let i=0;i<10;i++){ const dot=document.createElement('span'); dot.className='dot'; chips.appendChild(dot); }
    filterRow.appendChild(chips);
    log('built filterRow');
  }

  // Caption list
  let list = $('#captionList', pane);
  if (!list) {
    list = document.createElement('div');
    list.id='captionList';
    list.className='caption-list';
    list.style.height='220px';
    list.style.overflow='auto';
    list.style.border='1px solid rgba(255,255,255,0.08)';
    list.style.borderRadius='8px';
    pane.appendChild(list);
    log('built captionList');
  }

  // Title / Body inputs
  let title = $('#titleInput', pane);
  if (!title) {
    title = document.createElement('input');
    title.id='titleInput';
    title.placeholder='Title';
    title.className='input title';
    pane.appendChild(title);
  }
  let body = $('#bodyInput', pane);
  if (!body) {
    body = document.createElement('textarea');
    body.id='bodyInput';
    body.placeholder='Body';
    body.className='input body';
    body.rows=4;
    pane.appendChild(body);
  }
  log('built title/body');

  // Images refresh button
  let imgBtn = $('#refreshImagesBtn', pane);
  if (!imgBtn) {
    imgBtn = document.createElement('button');
    imgBtn.id='refreshImagesBtn';
    imgBtn.type='button';
    imgBtn.className='btn';
    imgBtn.textContent='Refresh images';
    pane.appendChild(imgBtn);
    log('built image strip row');
  }

  pane.dataset.capUiReady = '1';
  log('ready');
})();