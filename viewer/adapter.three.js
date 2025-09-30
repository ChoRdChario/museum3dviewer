import { bus } from '../core/bus.js';

export function createViewerAdapter({ canvas, bus:evbus }){
  const THREE = window.THREE;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias:true, alpha:false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio||1));
  renderer.setSize(canvas.clientWidth||800, canvas.clientHeight||600, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  // Cameras
  const persp = new THREE.PerspectiveCamera(50, 1, 0.01, 1000);
  persp.position.set(0.8, 0.8, 0.8);

  const ortho = new THREE.OrthographicCamera(-1,1,1,-1, 0.01, 1000);
  ortho.position.set(0.8, 0.8, 0.8);
  ortho.userData.v0 = 1; // base top*zoom
  let camera = persp;

  // Controls
  const controls = new THREE.OrbitControls(persp, renderer.domElement);
  const controlsOrtho = new THREE.OrbitControls(ortho, renderer.domElement);

  const light = new THREE.DirectionalLight(0xffffff, 1.0);
  light.position.set(1,2,3);
  scene.add(light);
  scene.add(new THREE.AmbientLight(0xffffff, 0.2));

  const raycaster = new THREE.Raycaster();
  const meshes = [];

  function rebuildMeshCache(root){
    meshes.length = 0;
    (root||scene).traverse(obj=>{
      if (obj && (obj.isMesh || obj.isSkinnedMesh)) meshes.push(obj);
    });
  }

  function ensureV0(){
    if (camera.isOrthographicCamera){
      if (typeof camera.userData.v0 !== 'number' || !isFinite(camera.userData.v0) || camera.userData.v0 === 0){
        const t = (typeof camera.top === 'number' && camera.top !== 0) ? Math.abs(camera.top) : 1;
        const z = (typeof camera.zoom === 'number' && camera.zoom > 0) ? camera.zoom : 1;
        camera.userData.v0 = t * z;
      }
    }
  }

  function resize(){
    const parent = canvas.parentElement || canvas;
    const w = parent.clientWidth || 800;
    const h = parent.clientHeight || 600;
    renderer.setSize(w, h, false);
    if (camera.isPerspectiveCamera){
      camera.aspect = Math.max(0.0001, w / Math.max(1,h));
      camera.updateProjectionMatrix();
    } else if (camera.isOrthographicCamera){
      ensureV0();
      const aspect = Math.max(0.0001, w / Math.max(1,h));
      const halfV = camera.userData.v0 / Math.max(0.0001, camera.zoom||1);
      camera.top    =  halfV;
      camera.bottom = -halfV;
      camera.left   = -halfV * aspect;
      camera.right  =  halfV * aspect;
      camera.updateProjectionMatrix();
    }
    evbus.emit('viewer:resized', {w,h,mode: camera.isOrthographicCamera ? 'ortho':'persp'});
  }

  function setOrtho(on){
    if (on){
      camera = ortho;
      controls.enabled = false;
      controlsOrtho.enabled = true;
    } else {
      camera = persp;
      controls.enabled = true;
      controlsOrtho.enabled = false;
    }
    evbus.emit('viewer:mode', on ? 'ortho' : 'persp');
    resize();
  }

  function animate(){
    requestAnimationFrame(animate);
    const c = camera.isOrthographicCamera ? controlsOrtho : controls;
    c.update();
    renderer.render(scene, camera);
  }
  animate();

  window.addEventListener('resize', resize);
  setTimeout(resize, 0);

  // GLB load helpers
  function loadURL(url){
    const loader = new THREE.GLTFLoader();
    loader.load(url, (gltf)=>{
      addModel(gltf.scene, url.split('/').pop());
    }, undefined, (err)=> console.error('[GLB]', err));
  }
  function loadFile(file){
    const url = URL.createObjectURL(file);
    loadURL(url);
  }
  function addModel(root, name='model'){
    // reset old model
    scene.children.slice().forEach(child=>{
      if (child.userData?.__isModelRoot) scene.remove(child);
    });
    root.userData.__isModelRoot = true;
    scene.add(root);
    rebuildMeshCache(root);
    // fit camera
    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3()).length();
    const center = box.getCenter(new THREE.Vector3());
    [camera, persp, ortho].forEach(cam=>{
      cam.position.copy(center.clone().add(new THREE.Vector3(1,1,1).normalize().multiplyScalar(size*0.8)));
      cam.near = size/1000; cam.far = size*10;
      cam.lookAt(center);
      cam.updateProjectionMatrix();
    });
    light.position.copy(center.clone().add(new THREE.Vector3(1,2,3).multiplyScalar(size)));
    evbus.emit('model:loaded', name);
    resize();
  }

  function raycastAt(clientX, clientY){
    const rect = renderer.domElement.getBoundingClientRect();
    const x = (clientX - rect.left) / rect.width * 2 - 1;
    const y = -((clientY - rect.top) / rect.height * 2 - 1);
    raycaster.setFromCamera({x,y}, camera);
    const hits = raycaster.intersectObjects(meshes, true);
    return hits[0] || null;
  }

  return {
    canvas: renderer.domElement,
    scene, camera,
    setOrtho, resize,
    raycastAt,
    loadURL, loadFile
  };
}
