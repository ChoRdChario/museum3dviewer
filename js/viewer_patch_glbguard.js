// viewer_patch_glbguard.js — Phase1f
// Wraps existing Viewer.loadGLB with preflight (GLB/JSON/HTML) detection.
// If Viewer is not present, does nothing.

(function(){
  function detectGltfKind(buf){
    try{
      var u8 = new Uint8Array(buf||[]);
      if (u8.length >= 12 && u8[0]===0x67 && u8[1]===0x6c && u8[2]===0x54 && u8[3]===0x46) {
        var ver = new DataView(buf).getUint32(4, true);
        return { kind:'GLB', version:ver };
      }
      var head = "";
      try { head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 4096))).replace(/^\s+/, ""); } catch(_){}
      if (head.indexOf("{")===0){
        var v = NaN;
        try { var j = JSON.parse(head); if (j && j.asset && j.asset.version) v = parseFloat(j.asset.version); } catch(_){}
        return { kind:'JSON', version:v };
      }
      if (/^<!DOCTYPE|^<html|^<HTML/.test(head)) return { kind:'HTML', version:NaN };
      return { kind:'UNKNOWN', version:NaN };
    }catch(e){
      return { kind:'ERR', version:NaN, error:String(e) };
    }
  }

  function toast(msg){
    try{
      if (window.__LMY && typeof window.__LMY.setStatus === 'function') { /* no-op */ }
      // minimal toast
      var host = document.getElementById('lmy_toast_host');
      if(!host){
        host = document.createElement('div');
        host.id = 'lmy_toast_host';
        host.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:10000;display:flex;flex-direction:column;gap:8px;';
        document.body.appendChild(host);
      }
      var el = document.createElement('div');
      el.style.cssText = 'background:#c92a2a;color:#fff;border:1px solid #a51111;border-radius:10px;padding:10px 14px;box-shadow:0 4px 18px #0008;font:12px ui-monospace,Menlo,Consolas,monospace;';
      el.textContent = msg;
      host.appendChild(el);
      setTimeout(function(){ el.remove(); }, 4500);
    }catch(_){}
  }

  function bytesFromAny(x){
    if (!x) return null;
    if (x instanceof ArrayBuffer) return x;
    if (ArrayBuffer.isView && ArrayBuffer.isView(x)) return x.buffer;
    if (x instanceof Blob && x.arrayBuffer) return x.arrayBuffer();
    return null;
  }

  if (!window.Viewer || !window.Viewer.prototype) return;

  var orig = window.Viewer.prototype.loadGLB;
  if (typeof orig !== 'function') return;

  window.Viewer.prototype.loadGLB = async function(data){
    try{
      var buf = await bytesFromAny(data);
      if (buf){
        var det = detectGltfKind(buf);
        console.log('[LociMyu] GLB preflight:', det);
        if (det.kind === 'HTML'){
          toast('DriveからHTMLが返却されています。共有設定/権限/URLを確認してください。');
          throw new Error('Drive returned HTML');
        }
        if (det.kind === 'GLB' && det.version < 2){
          toast('このGLBは glTF v'+det.version+' です。glTF 2.0 以上で再エクスポートしてください。');
          throw new Error('glTF v'+det.version+' (<2.0)');
        }
        if (det.kind === 'JSON' && !(det.version >= 2)){
          toast('このglTF(JSON)は v'+(isNaN(det.version)?'?':det.version)+' です。glTF 2.0 以上が必要です。');
          throw new Error('JSON glTF v'+det.version+' (<2.0)');
        }
      }
    }catch(e){
      console.warn('[viewer patch] preflight warning:', e);
    }
    // delegate to original
    return await orig.apply(this, arguments);
  };

  // Optional: orthographic zoom with wheel if implementation exposes cameraOrtho
  if (!window.__LMY_ORTHO_WHEEL){
    window.__LMY_ORTHO_WHEEL = true;
    window.addEventListener('wheel', function(e){
      try{
        var v = window.viewer || window.VIEWER || null;
        var cam = v && (v.cameraOrtho || v.ortho || v._cameraOrtho);
        if (cam && cam.isOrthographicCamera){
          e.preventDefault();
          var dz = (e.deltaY>0 ? 1.1 : 1/1.1);
          cam.zoom = Math.max(0.1, Math.min(128, cam.zoom * dz));
          if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
        }
      }catch(_){}
    }, { passive:false });
  }
})();