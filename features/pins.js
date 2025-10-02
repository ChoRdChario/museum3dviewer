// features/pins.js (v6.5.4-1)
import * as THREE from 'three';

export function mountPins({ bus, store, viewer }) {
  if (!store.state.pins) store.set({ pins: [] });

  const pinMap = new Map();
  let idSeq = 0;

  function setSelected(id) {
    store.set({ selected: id });
    bus.emit('pin:selected', id);
    for (const [pid, rec] of pinMap) {
      if (rec.line) rec.line.visible = (pid === id);
    }
  }

  function createPinSprite() {
    const g = new THREE.SphereGeometry(0.01, 12, 12);
    const m = new THREE.MeshBasicMaterial({ color: 0xff3366 });
    return new THREE.Mesh(g, m);
  }

  function createLeaderLine(from) {
    const head = from.clone().add(new THREE.Vector3(0, 0.05, 0));
    const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), head]);
    const mat = new THREE.LineBasicMaterial({ color: 0xff3366 });
    const line = new THREE.Line(geo, mat);
    line.visible = false;
    return line;
  }

  function addPinAt(pos, caption = {}, idOverride = null) {
    const id = idOverride || ('pin_' + (++idSeq));
    const sprite = createPinSprite(); sprite.position.copy(pos);
    const line = createLeaderLine(pos);
    viewer.scene.add(sprite); viewer.scene.add(line);

    const pin = {
      id, x: pos.x, y: pos.y, z: pos.z,
      caption: {
        title: caption.title || '新規キャプション',
        body: caption.body || '',
        img: caption.img || '',
        imageId: caption.imageId || '',
        thumbnailLink: caption.thumbnailLink || ''
      }
    };
    store.state.pins.push(pin);
    pinMap.set(id, { sprite, line });
    bus.emit('pin:added', pin);
    return id;
  }

  const canvas = viewer.canvas;
  canvas.addEventListener('click', (e) => {
    const hit = viewer.raycastAt(e.clientX, e.clientY);

    if (e.shiftKey || e.altKey) {
      if (hit) {
        const p = hit.point.clone ? hit.point.clone() : new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z);
        const id = addPinAt(p, {});
        setSelected(id);
      }
      return;
    }

    if (hit) {
      let best = null, bestD = Infinity;
      for (const [pid, rec] of pinMap) {
        const d = rec.sprite.position.distanceTo(hit.point);
        if (d < bestD) { bestD = d; best = pid; }
      }
      setSelected(best ?? null);
    } else {
      setSelected(null);
    }
  }, { capture: true });

  bus.on('pins:create', (payload) => {
    const list = Array.isArray(payload) ? payload : [payload];
    list.forEach(p => {
      const pos = new THREE.Vector3(Number(p.x)||0, Number(p.y)||0, Number(p.z)||0);
      const id = addPinAt(pos, { title:p.title, body:p.body, img:p.imageUrl, imageId:p.imageId, thumbnailLink:p.thumbnailLink }, p.id || null);
      const m = String(id).match(/(\d+)$/);
      if (m) { const n = parseInt(m[1], 10); if (n > idSeq) idSeq = n; }
    });
  });
}
