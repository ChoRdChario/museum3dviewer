// @license MIT
// materials.sheet.bridge.js (cache wrapper) — V6_15c
(function(){
  const TAG = '[mat-sheet]';
  const log = (...args)=>console.log(TAG, ...args);

  const prev = window.matSheet || {};

  const cache = new Map();

  async function passthroughLoadAll() {
    if (typeof prev.loadAll === 'function') {
      const rows = await prev.loadAll();
      try {
        cache.clear();
        (rows||[]).forEach(r => {
          if (!r) return;
          const k = r.materialKey || r.key || r.name;
          if (!k) return;
          cache.set(k, r);
        });
        log('cache primed', cache.size, 'rows');
      } catch(e){ console.warn(TAG, 'cache prime failed', e); }
      return rows;
    }
    console.warn(TAG, 'no prev.loadAll found; returning empty');
    return [];
  }

  async function passthroughUpsertOne(rec) {
    if (typeof prev.upsertOne === 'function') {
      const res = await prev.upsertOne(rec);
      try {
        const k = rec && (rec.materialKey || rec.key || rec.name);
        if (k) cache.set(k, Object.assign({}, cache.get(k)||{}, rec));
      } catch(e){ console.warn(TAG, 'cache set failed', e); }
      return res;
    }
    throw new Error('prev.upsertOne missing');
  }

  function getOne(materialKey){
    return cache.get(materialKey) || null;
  }

  window.matSheet = Object.assign({}, prev, {
    __wrapped: true,
    loadAll: passthroughLoadAll,
    upsertOne: passthroughUpsertOne,
    getOne,
    __cacheSize: ()=>cache.size,
  });

  log('cache wrapper installed');
})();
