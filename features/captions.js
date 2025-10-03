
// features/captions.js  (v6.6.4)
import { listSiblingsImages } from './drive.js';
import { readCaptions, saveCaptionDebounced } from './sheets.js';
import { getSelectedPin } from './pins.js';
import { toast } from './loading.js';

let spreadsheetId = null;
let fileId = null;
let captions = new Map();

export async function initCaptions(_fileId, _spreadsheetId){
  fileId = _fileId; spreadsheetId = _spreadsheetId;
  const list = await readCaptions(spreadsheetId);
  captions = new Map(list.map(c => [c.pinId, c]));
  renderImagesGrid();
  renderCaptionEditor();
}

function renderImagesGrid(){
  const side = document.getElementById('side');
  let box = document.getElementById('images-grid');
  if (!box){
    const hdr = document.createElement('div');
    hdr.textContent = 'Images (same folder)';
    hdr.style.cssText = 'font-weight:700;margin:10px 0 6px';
    side.appendChild(hdr);
    box = document.createElement('div');
    box.id = 'images-grid';
    box.style.cssText = 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px';
    side.appendChild(box);
  }
  box.innerHTML='';
  if (!fileId){ box.textContent = 'fileId未設定'; return; }
  listSiblingsImages(fileId).then(files=>{
    for(const f of files){
      const a = document.createElement('a');
      a.href = f.webViewLink; a.target = '_blank'; a.title = f.name;
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = f.thumbnailLink || `https://drive.google.com/uc?export=view&id=${f.id}`;
      img.style.cssText = 'width:100%;aspect-ratio:1/1;object-fit:cover;border-radius:10px;border:1px solid rgba(255,255,255,.06)';
      img.onclick = (ev)=>{ ev.preventDefault(); bindImageToSelected(`https://drive.google.com/uc?export=view&id=${f.id}`, f.thumbnailLink||''); };
      a.appendChild(img);
      box.appendChild(a);
    }
  }).catch(e=>{
    console.error(e);
    box.textContent = '画像の取得に失敗しました';
  });
}

function renderCaptionEditor(){
  const side = document.getElementById('side');
  let box = document.getElementById('caption-editor');
  if (!box){
    const hdr = document.createElement('div');
    hdr.textContent = 'Caption';
    hdr.style.cssText = 'font-weight:700;margin:10px 0 6px';
    side.appendChild(hdr);
    box = document.createElement('div');
    box.id = 'caption-editor';
    box.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin-bottom:10px';
    side.appendChild(box);
  }
  box.innerHTML = '';
  const title = document.createElement('input');
  title.placeholder = 'Title'; title.style.cssText='padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:#141820;color:#eaf1ff';
  const body = document.createElement('textarea');
  body.placeholder = 'Body'; body.rows=3; body.style.cssText='padding:8px;border-radius:10px;border:1px solid rgba(255,255,255,.06);background:#141820;color:#eaf1ff';
  const imgPreview = document.createElement('img'); imgPreview.style.cssText='max-width:100%;border-radius:10px;border:1px solid rgba(255,255,255,.06)';
  const saveBtn = document.createElement('button'); saveBtn.textContent = '保存'; saveBtn.onclick = ()=> doSave(title.value, body.value, imgPreview.dataset.src||'', imgPreview.src||'');
  box.append(title, body, imgPreview, saveBtn);

  // Load current selected pin caption (if any)
  const pin = getSelectedPin();
  if (pin){
    const cap = captions.get(pin.id) || { title:'', body:'', imageUrl:'', thumbUrl:'' };
    title.value = cap.title||'';
    body.value = cap.body||'';
    if (cap.imageUrl){
      imgPreview.src = cap.thumbUrl || cap.imageUrl;
      imgPreview.dataset.src = cap.imageUrl;
    }else{
      imgPreview.removeAttribute('src'); imgPreview.dataset.src='';
    }
  }else{
    title.value=''; body.value=''; imgPreview.removeAttribute('src'); imgPreview.dataset.src='';
  }
}

export function bindImageToSelected(imageUrl, thumbUrl=''){
  const pin = getSelectedPin();
  if (!pin){ toast.error('ピンを選択してください'); return; }
  const cap = captions.get(pin.id) || { pinId: pin.id, title:'', body:'', imageUrl:'', thumbUrl:'' };
  cap.imageUrl = imageUrl; cap.thumbUrl = thumbUrl;
  captions.set(pin.id, cap);
  renderCaptionEditor();
  saveCaptionDebounced(spreadsheetId, cap);
}

async function doSave(title, body, imageUrl, thumbUrl){
  const pin = getSelectedPin();
  if (!pin){ toast.error('ピンを選択してください'); return; }
  const cap = { pinId: pin.id, title, body, imageUrl, thumbUrl, updatedAt: new Date().toISOString() };
  captions.set(pin.id, cap);
  saveCaptionDebounced(spreadsheetId, cap);
  toast.success('キャプションを保存しました');
}

