// features/images_siblings.js  (v6.6.1)
import { listSiblingImages, downloadFileBlob } from './drive_ctx.js';
export async function renderImagesGrid(folderId) {
  const images = await listSiblingImages(folderId);
  if (window.__LMY_renderImageGrid) { window.__LMY_renderImageGrid(images); return; }
  const side = document.getElementById('side'); if (!side) return;
  const box = document.createElement('div'); box.style.marginTop='8px'; box.innerHTML='<h3>Images</h3>';
  const ul = document.createElement('ul'); ul.style.maxHeight='200px'; ul.style.overflow='auto';
  images.forEach(img=>{ const li=document.createElement('li'); li.style.cursor='pointer'; li.textContent=img.name; li.onclick=()=>document.dispatchEvent(new CustomEvent('lmy:image-picked',{detail:img})); ul.appendChild(li); });
  box.appendChild(ul); side.appendChild(box);
}
export { downloadFileBlob };
