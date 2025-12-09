// materials.sheet.bridge.js  v2.1 (legacy stub)
// 旧 __LM_MATERIALS 直接 append パイプラインは停止し、
// lm:sheet-context / lm:mat-opacity のイベントだけを透過させる。
// マテリアルの保存は LM_MaterialsPersist が一元的に担当する。

(function () {
  console.log('[mat-sheet v2.1] armed (legacy, write disabled)');

  // sheet-context はログだけ残し、シート情報は LM_MaterialsPersist 側の ctx として利用
  window.addEventListener('lm:sheet-context', (e) => {
    const detail = (e && e.detail) || {};
    const spreadsheetId = detail.spreadsheetId;
    const sheetGid = detail.sheetGid;
    console.log('[mat-sheet v2.1] sheet-context bound:', spreadsheetId, 'gid=', sheetGid);
  });

  // 旧来の lm:mat-opacity イベントを新パイプラインに橋渡しする。
  // これにより、古いコードがイベントを投げても __LM_MATERIALS には
  // LM_MaterialsPersist 経由で統一スキーマ行として保存される。
  try {
    window.addEventListener('lm:mat-opacity', (e) => {
      const d = (e && e.detail) || {};
      if (d.materialKey != null && d.opacity != null) {
        const payload = {
          materialKey: d.materialKey,
          opacity: d.opacity,
        };
        if (d.sheetGid != null) payload.sheetGid = String(d.sheetGid);
        window.LM_MaterialsPersist?.upsert?.(payload);
        console.log('[mat-bridge->persist] upsert opacity', payload.materialKey, payload.opacity);
      }
    });
  } catch (err) {
    console.warn('[mat-bridge->persist] adapter wiring failed', err);
  }
})();
