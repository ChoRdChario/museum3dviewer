// features/pins.js (v6.5.4-2 debug)
import * as THREE from 'three';

export function mountPins({ bus, store, viewer }) {
  if (!store.state.pins) store.set({ pins: [] });

  const pinMap = new Map();
  let idSeq = 0;

  function setSelected(id) {
    store.set({ selected: id });
    bus.emit('pin:selected', id);
    for (const [pid, rec] of pinMap) if (rec.line) rec.line.visible = (pid === id);
  }

  function addPinAt(pos, caption = {}, idOverride = null) {
    const id = idOverride || ('pin_' + (++idSeq));
    const dot = new THREE.Mesh(
      new THREE.SphereGeometry(0.01, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xff3366 })
    );
    dot.position.copy(pos);
    const head = pos.clone().add(new THREE.Vector3(0, 0.05, 0));
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([pos.clone(), head]),
      new THREE.LineBasicMaterial({ color: 0xff3366 })
    );
    line.visible = false;
    viewer.scene.add(dot, line);

    const pin = { id, x:pos.x, y:pos.y, z:pos.z, caption:{ title: caption.title||'新規キャプション', body: caption.body||'', img: caption.img||'', imageId: caption.imageId||'', thumbnailLink: caption.thumbnailLink||'' } };
    store.state.pins.push(pin);
    pinMap.set(id, { sprite: dot, line });
    bus.emit('pin:added', pin);
    return id;
  }

  viewer.canvas.addEventListener('click', (e) => {
    const hit = viewer.raycastAt(e.clientX, e.clientY);
    if (!hit) { console.debug('[pins] raycast miss'); return; }
    console.debug('[pins] hit', hit.object?.name || hit.object?.type, hit.point);

    if (e.shiftKey || e.altKey) {
      const p = hit.point.clone ? hit.point.clone() : new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z);
      const id = addPinAt(p, {});
      setSelected(id);
      return;
    }

    let best=null, bestD=Infinity;
    for (const [pid, rec] of pinMap) {
      const d = rec.sprite.position.distanceTo(hit.point);
      if (d < bestD) { bestD = d; best = pid; }
    }
    setSelected(best ?? null);
  }, { capture: true });

  bus.on('pins:create', (list) => {
    (Array.isArray(list) ? list : [list]).forEach(p => {
      const pos = new THREE.Vector3(Number(p.x)||0, Number(p.y)||0, Number(p.z)||0);
      const id = addPinAt(pos, { title:p.title, body:p.body, img:p.imageUrl, imageId:p.imageId, thumbnailLink:p.thumbnailLink }, p.id || null);
      const m = String(id).match(/(\d+)$/); if (m) { const n = parseInt(m[1],10); if (n>idSeq) idSeq=n; }
    });
  });
}
