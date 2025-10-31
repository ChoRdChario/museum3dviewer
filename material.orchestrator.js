/* material.orchestrator.js
 * LociMyu - Material panel wiring + persist/load
 * 要件:
 *  - window.viewerBridge.getScene(), .listMaterials()
 *  - window.materialsSheetBridge.{loadAll, upsertOne}
 *  - #pm-material セレクトと同カード内の opacity スライダ
 */
(function(){
  const VERSION_TAG = 'V6_15_LOAD_FIRST_NO_CLobber';
  const log  = (...a)=>console.log('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  // --- helpers --------------------------------------------------------------
  function getScene(){
    try { if (window.viewerBridge?.getScene) return window.viewerBridge.getScene(); } catch(e){}
    return window.__LM_SCENE || window.__viewer?.scene || window.viewer?.scene || window.lm?.scene || null;
  }
  function listMaterials(){ try { return window.viewerBridge?.listMaterials?.() || []; } catch(e){ return []; } }

  function applyOpacityByName(name, a){
    const sc=getScene(); if(!sc||!name) return 0;
    let hit=0;
    sc.traverse(o=>{
      const m=o.material; if(!m) return;
      (Array.isArray(m)?m:[m]).forEach(mm=>{
        if (mm?.name===name){
          mm.transparent = a < 1 ? true : mm.transparent;
          mm.opacity = a;
          mm.needsUpdate = true;
          hit++;
        }
      });
    });
    if (hit) log(`opacity ${a.toFixed(2)} → "${name}" x${hit}`);
    return hit;
  }

  function nearestSlider(from){
    let p = from.closest('section,fieldset,div') || from.parentElement;
    while(p){
      const r = p.querySelector('input[type="range"]');
      if (r) return r;
      p = p.parentElement;
    }
    return (document.querySelector('[data-lm="right-panel"] input[type="range"]') ||
            document.querySelector('input[type="range"]'));
  }

  function populateSelect(sel, names){
    sel.innerHTML='';
    const add=(v,t)=>{ const o=document.createElement('option'); o.value=v; o.textContent=t; sel.appendChild(o); };
    add('','-- Select --');
    names.forEach(n=>add(n,n));
    sel.value='';
  }

  // シート値を materialKey => 最新値 で引くための整形
  function latestByMaterialKey(allMap){
    const latest = new Map();
    for (const v of allMap.values()){
      // 末尾行勝ち（loadAll は行順に返ってくる想定）
      if (v?.materialKey) latest.set(v.materialKey, v);
    }
    return latest;
  }

  // --- main wiring ----------------------------------------------------------
  async function wireOnce(){
    const sel = document.getElementById('pm-material');
    if (!sel) { warn('panel select not found'); return false; }
    const slider = nearestSlider(sel);
    if (!slider) warn('opacity slider not found');

    const mats = listMaterials();
    if (!mats.length) { warn('no materials yet'); return false; }

    // ① populate
    populateSelect(sel, mats);

    // ② 先にシート値を読み、全マテリアルへ適用（初期化で保存はしない）
    let bootApplying = true;   // ←初期適用ガード
    let cacheLatest = null;
    try {
      const all = await window.materialsSheetBridge.loadAll();
      cacheLatest = latestByMaterialKey(all);

      // 全件適用（保存しない）
      for (const name of mats){
        const hit = cacheLatest.get(name);
        if (hit && hit.opacity!=null && hit.opacity!=='') {
          const a = Math.max(0, Math.min(1, Number(hit.opacity)));
          applyOpacityByName(name, a);
        }
      }
    } catch(e){
      warn('loadAll failed (continue without preload):', e);
    } finally {
      bootApplying = false; // ここからはユーザー操作のみ保存
    }

    // ③ イベント（input=適用のみ / pointerup|change=保存）
    // 重複防止のため clone 置換
    const sel2 = sel.cloneNode(true); sel2.id = sel.id; sel.parentNode.replaceChild(sel2, sel);
    let sld2 = slider;
    if (slider){ const c=slider.cloneNode(true); c.id=slider.id; slider.parentNode.replaceChild(c, slider); sld2 = c; }

    const onInput = () => {
      const name = sel2.value; if (!name || !sld2) return;
      const a = Math.max(0, Math.min(1, Number(sld2.value || 0)));
      applyOpacityByName(name, a);
    };

    const persistOnce = async () => {
      if (bootApplying) return; // 初期適用中は保存しない
      const name = sel2.value; if (!name || !sld2) return;
      const a = Math.max(0, Math.min(1, Number(sld2.value || 0)));

      try {
        await window.materialsSheetBridge.upsertOne({
          key: `${name}`,                // シンプルキー（必要に応じ強化）
          modelKey: '',                  // ここは後でGLB IDを入れる拡張余地
          materialKey: name,
          opacity: a,
          doubleSided: false,
          unlit: false,
          chromaEnable: false,
          chromaColor: '',
          chromaTolerance: '',
          chromaFeather: '',
          updatedBy: 'mat-orch'
        });
        log('persisted to sheet:', name);
      } catch(e){
        warn('persist failed:', e);
      }
    };

    sel2.addEventListener('change', onInput);              // 選択変更→適用のみ
    sld2?.addEventListener('input', onInput, {passive:true});  // スライド中→適用のみ

    // スライダ解放時に保存（マウス/タッチ両対応）
    ['change','mouseup','pointerup','touchend'].forEach(ev=>{
      sld2?.addEventListener(ev, persistOnce, {passive:true});
    });

    // ④ セレクト初期表示のスライダ値は、選択されたマテリアルの最新値に追従
    sel2.addEventListener('change', ()=>{
      if (!sld2) return;
      const name = sel2.value;
      const hit = cacheLatest?.get(name);
      const a = hit && hit.opacity!=null && hit.opacity!=='' ? Number(hit.opacity) : 1;
      sld2.value = String(a);
      // 変更直後は適用のみ。保存はユーザーが手を離したとき。
      onInput();
    });

    log('wired panel');
    return true;
  }

  function start(){
    log('loaded VERSION_TAG:', VERSION_TAG);

    // 初回試行
    if (wireOnce()) return;

    // scene-ready を何度でも拾う
    window.addEventListener('lm:scene-ready', ()=>{
      log('scene-ready received, trying wireOnce...');
      wireOnce();
    }, { once:false });

    // ポーリング（最大 ~20秒）
    let tries=0;
    const iv = setInterval(()=>{
      if (wireOnce()){ clearInterval(iv); }
      else {
        tries++;
        if (tries % 20 === 0) log('still trying...', tries);
        if (tries > 100){ clearInterval(iv); warn('gave up'); }
      }
    }, 200);
  }

  // 起動
  document.readyState === 'loading'
    ? document.addEventListener('DOMContentLoaded', start, {once:true})
    : start();
})();
