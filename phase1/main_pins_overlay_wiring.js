
/**
 * main_pins_overlay_wiring.js (safe v2)
 * - Avoids referencing THREE at parse time.
 * - Waits until window.THREE and window.viewer are available before installing.
 */
(function(){
  if (!window.LMY) window.LMY = {};
  const L = window.LMY;

  function installWhenReady(){
    const hasTHREE = !!window.THREE;
    const viewer = window.viewer;
    if (!hasTHREE || !viewer || !viewer.scene || !viewer.camera) return false;

    const THREE = window.THREE;
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

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
      line.visible = false;
      return line;
    }

    function setSelected(id){
      selectedId = id;
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
        return null;
      }
    };

    function installEvents(viewer){
      const canvas = viewer.canvas || viewer.renderer?.domElement;
      if (!canvas) return;

      // Add pin (Shift+Click)
      canvas.addEventListener('click', (e) => {
        if (!e.shiftKey) return;
        toCanvasXY(e, canvas);
        const hit = raycastOnMesh(viewer);
        if (!hit) return;
        L.pins.addPinAt(viewer, hit.point, { title: "新規キャプション", body: "" });
      });

      // Pick pin (Click)
      canvas.addEventListener('click', (e) => {
        if (e.shiftKey) return;
        toCanvasXY(e, canvas);
        L.pins.pickByRay(viewer);
      });

      // External custom events (optional)
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

    try { installEvents(viewer); } catch(e){ console.warn("[LMY] pins wiring install failed", e); }
    return true;
  }

  // Retry until ready
  let tries = 0;
  const timer = setInterval(()=>{
    tries++;
    if (installWhenReady() || tries > 200) clearInterval(timer);
  }, 50);

  // Also respond to explicit ready events
  window.addEventListener('lmy:viewer-ready', installWhenReady);
  window.addEventListener('three-ready', installWhenReady);
})();
