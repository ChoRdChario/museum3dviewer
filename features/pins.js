import * as THREE from 'three';

export function mountPins({ bus, store, viewer }){
  const pinMap=new Map();
  let idSeq=0;

  function setSelected(id){
    store.set({selected:id});
    bus.emit('pin:selected',id);
    for(const[pid,rec]of pinMap){
      if(rec.line) rec.line.visible = (pid===id);
    }
  }

  function createPinSprite(){
    const g=new THREE.SphereGeometry(0.01,12,12);
    const m=new THREE.MeshBasicMaterial({color:0xff3366});
    return new THREE.Mesh(g,m);
  }

  function createLeaderLine(from){
    const head=from.clone().add(new THREE.Vector3(0,0.05,0));
    const geo=new THREE.BufferGeometry().setFromPoints([from.clone(),head]);
    const mat=new THREE.LineBasicMaterial({color:0xff3366});
    const line=new THREE.Line(geo,mat);
    line.visible=false;
    return line;
  }

  function addPinAt(pos, caption={}, idOverride=null){
    const id = idOverride || ('pin_'+(++idSeq));
    const sprite=createPinSprite();
    sprite.position.copy(pos);
    const line=createLeaderLine(pos);
    viewer.scene.add(sprite);
    viewer.scene.add(line);
    const pin={id,x:pos.x,y:pos.y,z:pos.z,caption:{title:caption.title||'新規キャプション',body:caption.body||'',img:caption.img||''}};
    store.state.pins.push(pin);
    pinMap.set(id,{sprite,line});
    bus.emit('pin:added', pin);
    return id;
  }

  // Mouse interactions
  const canvas=viewer.canvas;
  canvas.addEventListener('click',(e)=>{
    const hit=viewer.raycastAt(e.clientX,e.clientY);
    if(e.shiftKey||e.altKey){
      if(hit){
        const pos = hit.point.clone ? hit.point.clone() : new THREE.Vector3(hit.point.x,hit.point.y,hit.point.z);
        const id = addPinAt(pos, {});
        setSelected(id);
      }
      return;
    }
    if(hit){
      let best=null,bestD=Infinity;
      for(const[pid,rec]of pinMap){
        const dx=rec.sprite.position.x-hit.point.x,dy=rec.sprite.position.y-hit.point.y,dz=rec.sprite.position.z-hit.point.z;
        const d=Math.hypot(dx,dy,dz);
        if(d<bestD){bestD=d;best=pid;}
      }
      setSelected(best??null);
    }else{
      setSelected(null);
    }
  }, {capture:true});

  // Programmatic creation from external modules (e.g., Sheets restore)
  bus.on('pins:create', (payload)=>{
    // payload can be a single pin or an array
    const list = Array.isArray(payload) ? payload : [payload];
    list.forEach(p=>{
      const pos = new THREE.Vector3(Number(p.x)||0, Number(p.y)||0, Number(p.z)||0);
      const id = addPinAt(pos, {title:p.title, body:p.body, img:p.imageUrl, imageId:p.imageId}, p.id||null);
      // keep idSeq in sync if ids came from sheet like "pin_12"
      const m = String(id).match(/(\d+)$/); if(m){ idSeq = Math.max(idSeq, parseInt(m[1],10)); }
    });
  });
}
