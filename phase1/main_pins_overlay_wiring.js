
/**
 * main_pins_overlay_wiring.js
 * Phase1: lmy:* イベント配線（ピン追加/選択）とオーバーレイ表示の最低限。
 * 使い方: three.js/viewer 初期化後に読み込む。
 */
(function(){
  if (!window.LMY) window.LMY = {};
  const L = window.LMY;

  // 依存: THREE, viewer(scene,camera,renderer), raycaster
  const raycaster = new THREE.Raycaster();
  const mouse = new THREE.Vector2();

  // ピン保持 (id -> {pos:THREE.Vector3, sprite:THREE.Object3D, line:THREE.Line, data:any})
  const pinMap = new Map();
  let selectedId = null;
  let _idSeq = 0;

  function toCanvasXY(e, canvas){
    const rect = canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * 2 - 1;
    const y = -((e.clientY - rect.top) / rect.height * 2 - 1);
    mouse.set(x, y);
  }

  function raycastOnMesh(viewer){
    const cam = viewer.camera;
    const scene = viewer.scene;
    raycaster.setFromCamera(mouse, cam);
    // Meshだけを対象に
    const hits = raycaster.intersectObjects(scene.children, true).filter(h => {
      const m = h.object;
      return m && (m.isMesh || m.isSkinnedMesh);
    });
    return hits[0] || null;
  }

  function createPinSprite(){
    const g = new THREE.SphereGeometry(0.01, 12, 12);
    const m = new THREE.MeshBasicMaterial({color: 0xff3366});
    return new THREE.Mesh(g, m);
  }

  function createLeaderLine(from, to){
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), to.clone()]);
    const mat = new THREE.LineBasicMaterial({color: 0xff3366});
    const line = new THREE.Line(geo, mat);
    line.visible = false; // 選択時のみ
    return line;
  }

  function setSelected(id){
    selectedId = id;
    // すべてのラインを非表示 → 選択のみ可視
    for (const [pid, rec] of pinMap) {
      if (rec.line) rec.line.visible = (pid === selectedId);
    }
  }

  function showOverlayFromCaption(caption){
    const api = window.__LMY_overlay;
    if (!api || !api.showOverlay) return;
    api.showOverlay({
      title: caption?.title || "",
      body: caption?.body || "",
      imgUrl: caption?.imageUrl || null
    });
  }

  function hideOverlay(){
    const api = window.__LMY_overlay;
    if (api && api.hideOverlay) api.hideOverlay();
  }

  // 公開API
  L.pins = {
    getSelectedId: () => selectedId,
    getPin: (id) => pinMap.get(id),
    forEach: (fn) => { for (const [id, rec] of pinMap) fn(id, rec); },
    addPinAt(viewer, point, caption={}){
      const sprite = createPinSprite();
      sprite.position.copy(point);
      const origin = point.clone();
      const head   = point.clone().add(new THREE.Vector3(0, 0.05, 0));
      const line = createLeaderLine(origin, head);

      const id = `pin_${++_idSeq}`;
      viewer.scene.add(sprite);
      viewer.scene.add(line);
      pinMap.set(id, {pos: point.clone(), sprite, line, caption});

      setSelected(id);
      showOverlayFromCaption(caption);
      return id;
    },
    pickByRay(viewer){
      const hit = raycastOnMesh(viewer);
      if (!hit) { setSelected(null); hideOverlay(); return null; }
      // 近傍のピンがあればそれを選択、なければ最近点に新設？ → ここでは既存選択優先
      let nearestId = null;
      let minD = Infinity;
      for (const [id, rec] of pinMap) {
        const d = rec.pos.distanceTo(hit.point);
        if (d < minD) { minD = d; nearestId = id; }
      }
      if (nearestId && minD < 0.03){
        setSelected(nearestId);
        const rec = pinMap.get(nearestId);
        showOverlayFromCaption(rec.caption);
        return nearestId;
      }
      // 近接ピンが無ければ何もしない（追加は Shift+Click に限定）
      return null;
    }
  };

  // ===== イベント配線 =====
  function installEvents(viewer){
    const canvas = viewer.canvas || viewer.renderer?.domElement;
    if (!canvas) return;

    // 追加（Shift+クリック）
    canvas.addEventListener('click', (e) => {
      if (!e.shiftKey) return;
      toCanvasXY(e, canvas);
      const hit = raycastOnMesh(viewer);
      if (!hit) return;
      L.pins.addPinAt(viewer, hit.point, { title: "新規キャプション", body: "" });
    });

    // 選択（通常クリック）
    canvas.addEventListener('click', (e) => {
      if (e.shiftKey) return; // 追加で処理済み
      toCanvasXY(e, canvas);
      L.pins.pickByRay(viewer);
    });

    // 既定の lmy:* カスタムイベントも受け付け（外部UIから呼ばれる想定）
    document.addEventListener('lmy:add-pin', (e)=>{
      const {x, y} = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      mouse.set(x, y);
      const hit = raycastOnMesh(viewer);
      if (!hit) return;
      L.pins.addPinAt(viewer, hit.point, e.detail.caption || {});
    });

    document.addEventListener('lmy:pick-pin', (e)=>{
      const {x, y} = e.detail || {};
      if (typeof x !== 'number' || typeof y !== 'number') return;
      mouse.set(x, y);
      L.pins.pickByRay(viewer);
    });
  }

  // 自動インストール（viewer が window.viewer にぶら下がる想定の簡易版）
  if (window.viewer && window.THREE) {
    try { installEvents(window.viewer); } catch(e){ console.warn("[LMY] pins wiring failed", e); }
  } else {
    // 遅延初期化: window に viewer が入ったら呼んでね
    L.installPinsOverlay = installEvents;
  }
})();
