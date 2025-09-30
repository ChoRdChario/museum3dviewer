
/**
 * image_grid_bootstrap.js
 * Phase1: 画像グリッドの即席実装（無い場合に最低限のUIを生成）。
 * 使い方: Drive 同階層画像の配列を window.__LMY_renderImageGrid(images) に渡す。
 */
(function(){
  if (!window.__LMY_renderImageGrid) {
    // 最低限の簡易グリッドをページ末尾に生成
    const host = document.createElement('div');
    host.id = 'lmy-image-grid';
    Object.assign(host.style, {
      position: 'fixed',
      right: '12px',
      bottom: '12px',
      width: '320px',
      maxHeight: '50vh',
      overflow: 'auto',
      background: 'rgba(0,0,0,0.6)',
      backdropFilter: 'blur(4px)',
      padding: '8px',
      borderRadius: '12px',
      color: '#fff',
      font: '12px/1.4 system-ui, sans-serif',
      zIndex: 9999
    });
    host.innerHTML = '<div style="margin:4px 0 8px; font-weight:600;">Images (same folder)</div><div class="grid" style="display:grid; grid-template-columns:repeat(3, 1fr); gap:6px;"></div>';
    document.body.appendChild(host);

    window.__LMY_renderImageGrid = function(images){
      const grid = host.querySelector('.grid');
      grid.innerHTML = '';
      (images || []).forEach(file => {
        const btn = document.createElement('button');
        btn.title = file.name || file.id;
        Object.assign(btn.style, {
          display: 'block', border: 'none', padding: 0, background: 'transparent', cursor: 'pointer'
        });
        const img = document.createElement('img');
        img.src = file.thumbnailLink || file.iconLink || '';
        img.alt = file.name || '';
        Object.assign(img.style, { width: '100%', aspectRatio: '1/1', objectFit: 'cover', borderRadius: '6px' });
        btn.appendChild(img);
        btn.addEventListener('click', ()=>{
          const ev = new CustomEvent('lmy:image-picked', { detail: file });
          document.dispatchEvent(ev);
        });
        grid.appendChild(btn);
      });
    };
  }

  // HEIC → JPEG 変換ユーティリティの確保
  window.__LMY_ensureHeic2Any = async function(){
    if (window.heic2any) return true;
    // CDN を使っていない場合はスキップ（既存のローダがあればそちらを使用）
    return false;
  };

  // 参考: Drive 同階層画像の列挙（実装例）
  // 実際は既存の drive.* API を使うこと。ここでは疑似実装。
  window.__LMY_listSiblingImages = async function(opts){
    console.warn("[LMY] __LMY_listSiblingImages is a stub. Use existing drive.js list method.");
    return [];
  };
})();
