// fallback_viewer_bootstrap.js — CDN-pinned three.js + OrbitControls; relies on import map for 'three'
const THREE_URL = 'three'; // resolved by import map
const ORBIT_URL = 'https://unpkg.com/three@0.157.0/examples/jsm/controls/OrbitControls.js';

export async function ensureDemo({ mount }) {
  if (!mount) throw new Error('ensureDemo: mount element not provided');
  let spinner = document.getElementById('spinner');
  if (!spinner) {
    spinner = document.createElement('div');
    spinner.id = 'spinner';
    spinner.textContent = 'Loading three.js…';
    spinner.style.position = 'absolute';
    spinner.style.inset = '0';
    spinner.style.display = 'grid';
    spinner.style.placeItems = 'center';
    spinner.style.color = '#ddd';
    spinner.style.font = '14px/1.4 system-ui';
    mount.appendChild(spinner);
  }

  try {
    const THREE = await import(THREE_URL);
    const { OrbitControls } = await import(ORBIT_URL);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(devicePixelRatio);
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x101014);

    const camera = new THREE.PerspectiveCamera(60, mount.clientWidth / mount.clientHeight, 0.1, 1000);
    camera.position.set(2.5, 2, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    const light = new THREE.HemisphereLight(0xffffff, 0x222233, 1.0);
    scene.add(light);

    const geo = new THREE.BoxGeometry(1,1,1);
    const mat = new THREE.MeshStandardMaterial({ color: 0x4da3ff, metalness: 0.2, roughness: 0.4 });
    const mesh = new THREE.Mesh(geo, mat);
    scene.add(mesh);

    function onResize() {
      const w = mount.clientWidth, h = mount.clientHeight || 1;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    new ResizeObserver(onResize).observe(mount);

    function tick() {
      mesh.rotation.y += 0.01;
      controls.update();
      renderer.render(scene, camera);
      requestAnimationFrame(tick);
    }

    spinner?.remove();
    tick();
  } catch (err) {
    console.error('[fallback_viewer_bootstrap] failed to init', err);
    if (spinner) spinner.textContent = 'Failed to load three.js (CDN). See console.';
    throw err;
  }
}
