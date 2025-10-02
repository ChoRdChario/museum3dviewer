import * as THREE from 'three';
import bus from './bus.js';
import store from './store.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

export function mountViewer(canvas, camera, scene) {
  function onCanvasClick(ev) {
    const rect = canvas.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      const mesh = intersects[0].object;
      if (mesh.isMesh) {
        store.set({ selectedMesh: mesh });
        bus.emit('mesh:selected', mesh);
      }
    }
  }
  canvas.addEventListener('click', onCanvasClick);
}
