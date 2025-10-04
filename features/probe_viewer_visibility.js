
/**
 * probe_viewer_visibility.js (revised)
 * - Logs host and canvas visibility metrics
 * - If no canvas is present after 1s, ensures a tiny demo viewer to verify CSS/GL stack
 * - Uses relative import for three to satisfy browser module resolver
 */
(function(){
  const log = (...args)=>console.log("[probe]", ...args);

  function markCanvas() {
    const cvs = document.querySelector("canvas");
    if (!cvs) { log("no canvas found"); return false; }
    const r = cvs.getBoundingClientRect();
    const styles = getComputedStyle(cvs);
    log(`canvas ${Math.round(r.width)}x${Math.round(r.height)} vis=${styles.visibility} disp=${styles.display} pos=${styles.position}`);
    cvs.dataset.probe = "ok";
    return true;
  }

  function markHost() {
    const host = document.getElementById("stage") || document.getElementById("viewer-host") || document.body;
    const r = host.getBoundingClientRect();
    const styles = getComputedStyle(host);
    log(`host #${host.id||"body"} ${Math.round(r.width)}x${Math.round(r.height)} disp=${styles.display} pos=${styles.position} z=${styles.zIndex}`);
    return host;
  }

  async function ensureDemo(host) {
    try {
      if (document.querySelector("canvas")) return; // canvas exists, do nothing
      // Import three from relative path used in this repo
      const THREE = await import("../lib/three.module.js").catch(async () => {
        // fallback one level up if this script is served from /museum3dviewer/features
        return await import("./../lib/three.module.js");
      });
      const canvas = document.createElement("canvas");
      canvas.id = "probe-demo-canvas";
      canvas.style.cssText = "position:absolute;inset:0;display:block;";
      host.appendChild(canvas);
      const renderer = new THREE.WebGLRenderer({canvas, antialias:true, alpha:true});
      renderer.setSize(host.clientWidth, host.clientHeight, false);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, host.clientWidth/host.clientHeight, 0.1, 100);
      camera.position.set(2,2,3);
      const geo = new THREE.BoxGeometry(1,1,1);
      const mat = new THREE.MeshNormalMaterial();
      const cube = new THREE.Mesh(geo, mat);
      scene.add(cube);
      const light = new THREE.DirectionalLight(0xffffff, 1); light.position.set(1,2,3); scene.add(light);
      function onResize(){
        const w = host.clientWidth, h = host.clientHeight;
        renderer.setSize(w,h,false);
        camera.aspect = w/h; camera.updateProjectionMatrix();
      }
      window.addEventListener("resize", onResize);
      (function animate(){
        cube.rotation.x += 0.01; cube.rotation.y += 0.015;
        renderer.render(scene,camera);
        requestAnimationFrame(animate);
      })();
      log("demo mounted");
    } catch(e) {
      console.warn("[probe] demo mount failed", e);
    }
  }

  window.addEventListener("DOMContentLoaded", () => {
    const host = markHost();
    setTimeout(() => {
      if (!markCanvas()) ensureDemo(host);
    }, 1000);
  });
})();
