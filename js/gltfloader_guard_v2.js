// gltfloader_guard_v2.js — hook GLTFLoader.parse with preflight (robust attach)
// Load this AFTER three.js and GLTFLoader.js. It will attach even if GLTFLoader appears later.
(function(){
  function attach(){
    try{
      if (!window.THREE || !THREE.GLTFLoader || !THREE.GLTFLoader.prototype || typeof THREE.GLTFLoader.prototype.parse !== 'function') return false;
      const orig = THREE.GLTFLoader.prototype.parse;
      if (THREE.GLTFLoader.prototype.__lmy_guard_attached) return true;

      function detectKindFromArrayBuffer(buf){
        try{
          const u8 = new Uint8Array(buf||[]);
          if (u8.length >= 12 && u8[0]===0x67 && u8[1]===0x6c && u8[2]===0x54 && u8[3]===0x46) {
            const ver = new DataView(buf).getUint32(4, true);
            return { kind:'GLB', version:ver };
          }
          const head = new TextDecoder().decode(u8.subarray(0, Math.min(u8.length, 4096))).trimStart();
          if (head.startsWith('{')) {
            let v = NaN;
            try { const j = JSON.parse(head); v = parseFloat(j?.asset?.version); } catch(_){}
            return { kind:'JSON', version:v };
          }
          if (head.startsWith('<!DOCTYPE') || head.startsWith('<html') || head.startsWith('<HTML')) {
            return { kind:'HTML', version:NaN };
          }
        }catch(e){ return { kind:'ERR', version:NaN, error:String(e) }; }
        return { kind:'UNKNOWN', version:NaN };
      }

      THREE.GLTFLoader.prototype.parse = function(data, path, onLoad, onError){
        try{
          // If data is ArrayBuffer or view
          let buf = null;
          if (data && data.byteLength !== undefined) {
            buf = (data.buffer && data.byteLength !== data.buffer.byteLength) ? data.buffer : data;
          }
          if (buf instanceof ArrayBuffer){
            const det = detectKindFromArrayBuffer(buf);
            console.log('[LociMyu] GLTFLoader preflight:', det);
            if (det.kind === 'HTML') {
              const err = new Error('DriveからHTMLが返却されています。共有設定/権限/URLを確認してください。');
              if (onError) onError(err); else throw err;
              return;
            }
            if (det.kind === 'GLB' && det.version < 2){
              const err = new Error('このGLBは glTF v'+det.version+' です。glTF 2.0 以上で再エクスポートしてください。');
              if (onError) onError(err); else throw err;
              return;
            }
          } else if (data && typeof data === 'object' && data.asset && data.asset.version){
            const v = parseFloat(data.asset.version);
            console.log('[LociMyu] GLTFLoader preflight(JSON):', v);
            if (!(v >= 2)){
              const err = new Error('このglTF(JSON)は v'+(isNaN(v)?'?':v)+' です。glTF 2.0 以上が必要です。');
              if (onError) onError(err); else throw err;
              return;
            }
          }
        }catch(e){
          console.warn('[gltf guard] preflight warning:', e);
        }
        return orig.call(this, data, path, onLoad, onError);
      };
      THREE.GLTFLoader.prototype.__lmy_guard_attached = true;
      console.log('[LociMyu] gltfloader_guard attached');
      return true;
    }catch(e){
      console.warn('[gltf guard] attach failed:', e);
      return false;
    }
  }

  if (!attach()){
    let tries = 0;
    const timer = setInterval(()=>{
      if (attach() || ++tries > 40) clearInterval(timer);
    }, 200);
    window.addEventListener('load', attach, { once:true });
  }
})();