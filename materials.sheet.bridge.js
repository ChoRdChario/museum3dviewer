// materials.sheet.bridge.js  v2.1 (legacy stub)
// 旧 __LM_MATERIALS append パイプラインは廃止し、
// lm:mat-opacity → LM_MaterialsPersist.upsert のブリッジだけを残す。

(function () {
  console.log('[mat-sheet v2.1] disabled; using LM_MaterialsPersist only');

  try {
    window.addEventListener('lm:mat-opacity', (e) => {
      const d = (e && e.detail) || {};
      if (d.materialKey != null && d.opacity != null) {
        window.LM_MaterialsPersist?.upsert?.({ materialKey: d.materialKey, opacity: d.opacity });
        console.log('[mat-bridge->persist] upsert opacity', d.materialKey, d.opacity);
      }
    });
  } catch (err) {
    console.warn('[mat-bridge->persist] adapter wiring failed', err);
  }
})();
