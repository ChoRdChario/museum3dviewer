
/**
 * spec_enforcer.js
 * 目的: 仕様に沿った処理だけを生かし、古い処理の二重実行を止める。
 * - viewer.resize を正規ロジックで上書き＆固定（non-writable）
 * - canvas の匿名リスナを一掃（cloneNode）してから我々のリスナだけを装着
 * - 旧リーダーライン（DOM/SVG）をCSSで抑止
 * - 画像ドロップダウンを隠し、グリッドに一本化
 * - オーバーレイのフォールバック実装（__LMY_overlay が無ければ注入）
 */
(function(){
  if (!window.LMY) window.LMY = {};
  const L = window.LMY;

  function ensureOverlayFallback(){
    if (window.__LMY_overlay && typeof window.__LMY_overlay.showOverlay === 'function') return;
    const layer = document.createElement('div');
    layer.id = 'lmy-overlay-fallback';
    Object.assign(layer.style, {
      position:'fixed', left:'16px', bottom:'16px', maxWidth:'380px',
      background:'rgba(0,0,0,0.7)', color:'#fff', padding:'12px 14px',
      borderRadius:'12px', font:'14px/1.5 system-ui, sans-serif',
      zIndex: 10000, display:'none', backdropFilter:'blur(4px)'
    });
    layer.innerHTML = '<div style="font-weight:700" id="lmy-ol-title"></div><div id="lmy-ol-body"></div><img id="lmy-ol-img" style="display:none;max-width:100%;margin-top:8px;border-radius:8px">';
    document.body.appendChild(layer);

    window.__LMY_overlay = {
      showOverlay({title='', body='', imgUrl=null}={}){
        layer.querySelector('#lmy-ol-title').textContent = title;
        layer.querySelector('#lmy-ol-body').textContent = body;
        const img = layer.querySelector('#lmy-ol-img');
        if (imgUrl) { img.src = imgUrl; img.style.display = 'block'; }
        else { img.style.display = 'none'; }
        layer.style.display = 'block';
      },
      hideOverlay(){
        layer.style.display = 'none';
      }
    };
  }

  function hideLegacyLinesAndPickers(){
    const style = document.createElement('style');
    style.id = 'lmy-spec-hide-legacy';
    style.textContent = `
      /* 旧ライン（推定クラス/属性） */
      .lmy-leader, .pin-line, [data-lmy-line] { display: none !important; }
      /* 旧画像ピッカー */
      select#image-select, .image-dropdown, [data-lmy-image-select] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  function enforceSingleResize(viewer){
    if (!viewer || !viewer.camera || !viewer.renderer) return;
    const cam = viewer.camera;
    const renderer = viewer.renderer;

    // Ortho基準値 v0 を確定：top*zoom を固定
    function ensureV0(){
      if (cam.isOrthographicCamera) {
        if (typeof cam.userData.v0 !== 'number' || !isFinite(cam.userData.v0) || cam.userData.v0 === 0){
          const t = (typeof cam.top === 'number' && cam.top !== 0) ? Math.abs(cam.top) : 1;
          const z = (typeof cam.zoom === 'number' && cam.zoom > 0) ? cam.zoom : 1;
          cam.userData.v0 = t * z;
        }
      }
    }

    function resizeImpl(){
      try{
        const size = new THREE.Vector2();
        renderer.getSize(size);
        let w = size.x, h = size.y;
        if (!w || !h){
          const canvas = renderer.domElement;
          w = canvas?.clientWidth || canvas?.width || 1;
          h = canvas?.clientHeight || canvas?.height || 1;
        }
        if (cam.isOrthographicCamera){
          ensureV0();
          const aspect = Math.max(0.0001, w / Math.max(1, h));
          const halfV = cam.userData.v0 / Math.max(0.0001, cam.zoom);
          cam.top    =  halfV;
          cam.bottom = -halfV;
          cam.left   = -halfV * aspect;
          cam.right  =  halfV * aspect;
          cam.updateProjectionMatrix();
        }
      }catch(e){
        console.warn('[LMY] resizeImpl error', e);
      }
    }

    // 固定化：以後、上書きされないようにする
    try{
      Object.defineProperty(viewer, 'resize', {
        value: resizeImpl,
        writable: false,
        configurable: false
      });
    }catch(e){
      // defineProperty できない場合でも最後に代入しておく
      viewer.resize = resizeImpl;
    }

    // window リサイズで我々のみ呼ぶ（既存 onresize を置換）
    window.onresize = () => { viewer.resize(); };
    // 初回適用
    viewer.resize();
  }

  function replaceCanvasListeners(viewer){
    const canvas = viewer?.canvas || viewer?.renderer?.domElement;
    if (!canvas) return {canvas:null};
    const parent = canvas.parentNode;
    const next = canvas.nextSibling;
    const clone = canvas.cloneNode(true); // リスナをすべて破棄
    if (parent) {
      parent.removeChild(canvas);
      if (next) parent.insertBefore(clone, next);
      else parent.appendChild(clone);
    }
    // 使用する側が参照している場合に備え、viewer.canvas を差し替え
    try { viewer.canvas = clone; } catch(e){}
    // 基本プロパティ
    clone.style.touchAction = 'none';
    clone.style.pointerEvents = 'auto';
    clone.tabIndex = 0;
    return {canvas: clone};
  }

  function installPinHandlers(viewer){
    if (!window.THREE) return;
    const THREE = window.THREE;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const pinMap = new Map();
    let selectedId = null;
    let _idSeq = 0;
    const meshes = [];

    // raycast対象をキャッシュ（GLBロード後も呼ぶこと）
    function rebuildMeshCache(){
      meshes.length = 0;
      viewer.scene.traverse(obj => {
        if (obj && (obj.isMesh || obj.isSkinnedMesh)) meshes.push(obj);
      });
    }
    rebuildMeshCache();
    window.addEventListener('lmy:model-loaded', rebuildMeshCache);

    function toCanvasXY(e, canvas){
      const rect = canvas.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height * 2 - 1);
      mouse.set(x, y);
    }
    function raycast(){
      raycaster.setFromCamera(mouse, viewer.camera);
      const hits = raycaster.intersectObjects(meshes, true);
      return hits[0] || null;
    }
    function createPinSprite(){
      const g = new THREE.SphereGeometry(0.01, 12, 12);
      const m = new THREE.MeshBasicMaterial({color: 0xff3366});
      return new THREE.Mesh(g, m);
    }
    function createLeaderLine(from){
      const head = from.clone().add(new THREE.Vector3(0, 0.05, 0));
      const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), head]);
      const mat = new THREE.LineBasicMaterial({color: 0xff3366});
      const line = new THREE.Line(geo, mat);
      line.visible = false;
      return line;
    }
    function setSelected(id){
      selectedId = id;
      for (const [pid, rec] of pinMap) {
        if (rec.line) rec.line.visible = (pid === selectedId);
      }
      // 旧DOMラインも抑止（保険）
      document.querySelectorAll('.lmy-leader, .pin-line, [data-lmy-line]').forEach(el=> el.style.display = (id? '' : 'none'));
    }
    function showOverlay(caption){
      (window.__LMY_overlay||{}).showOverlay?.({
        title: caption?.title || '',
        body: caption?.body || '',
        imgUrl: caption?.imageUrl || null
      });
    }
    function hideOverlay(){ (window.__LMY_overlay||{}).hideOverlay?.(); }

    function addPinAt(point, caption={}){
      const sprite = createPinSprite();
      sprite.position.copy(point);
      const line = createLeaderLine(point);
      viewer.scene.add(sprite);
      viewer.scene.add(line);
      const id = 'pin_'+(++_idSeq);
      pinMap.set(id, {pos: point.clone(), sprite, line, caption});
      setSelected(id);
      showOverlay(caption);
      return id;
    }

    const canvas = viewer.canvas || viewer.renderer.domElement;
    // capture: true で上層UIより先に受け取り、伝播は止める
    canvas.addEventListener('click', (e)=>{
      e.stopPropagation();
      // Shift+Click → 追加
      if (e.shiftKey || e.altKey){
        toCanvasXY(e, canvas);
        const hit = raycast();
        if (hit) addPinAt(hit.point, {title:'新規キャプション', body:''});
        return;
      }
      // 通常Click → 選択
      toCanvasXY(e, canvas);
      const hit = raycast();
      if (!hit){ setSelected(null); hideOverlay(); return; }
      // 最近傍ピンの選択：閾値 3cm 相当
      let best = null, bestD = Infinity;
      for (const [id, rec] of pinMap){
        const d = rec.pos.distanceTo(hit.point);
        if (d < bestD){ bestD = d; best = id; }
      }
      if (best && bestD < 0.03){
        setSelected(best);
        showOverlay(pinMap.get(best).caption);
      }
    }, {capture:true});

    // 公開（必要なら）
    L.store = L.store || {};
    L.store.pins = {pinMap, get selected(){return selectedId;}, setSelected};
  }

  function boot(){
    // Overlay フォールバックとレガシー抑止
    ensureOverlayFallback();
    hideLegacyLinesAndPickers();

    // viewer/THREE が ready になるまで待機
    let tries = 0;
    const t = setInterval(()=>{
      tries++;
      if (window.viewer && window.THREE){
        try{
          enforceSingleResize(window.viewer);
          const res = replaceCanvasListeners(window.viewer);
          installPinHandlers(window.viewer);
        }catch(e){ console.warn('[LMY] spec_enforcer boot error', e); }
        clearInterval(t);
      }
      if (tries > 200) clearInterval(t);
    }, 50);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    window.addEventListener('DOMContentLoaded', boot);
  }
  window.addEventListener('lmy:viewer-ready', boot);
  window.addEventListener('three-ready', boot);
})();
