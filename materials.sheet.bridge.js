// materials.sheet.bridge.js  v2.2 (bridge-only, no direct __LM_MATERIALS writes)
// - Listens for legacy lm:mat-opacity events
// - Delegates to LM_MaterialsPersist.upsert if present
// - Does NOT write to __LM_MATERIALS (header-only policy is enforced elsewhere)

(function () {
  const Q = [];
  let ctx = null;
  let busy = false;

  function havePersist() {
    const P = window.LM_MaterialsPersist;
    return !!(P && typeof P.upsert === 'function');
  }

  function enqueue(payload) {
    Q.push(payload);
    drain();
  }

  async function drain() {
    if (busy || !ctx || !Q.length) return;
    busy = true;
    try {
      while (Q.length) {
        const p = Q.shift();
        const P = window.LM_MaterialsPersist;
        if (!P || typeof P.upsert !== 'function') {
          console.log('[mat-sheet v2.2] LM_MaterialsPersist missing; drop payload', p);
          continue;
        }
        const upsertPayload = {
          materialKey: p.materialKey,
          opacity: p.opacity,
          sheetContext: ctx,
          updatedAt: p.updatedAt || new Date().toISOString(),
          updatedBy: p.updatedBy || 'ui',
        };
        try {
          await P.upsert(upsertPayload);
          console.log('[mat-sheet v2.2] delegated to LM_MaterialsPersist', upsertPayload);
        } catch (e) {
          console.warn('[mat-sheet v2.2] LM_MaterialsPersist.upsert failed', e && (e.message || e));
        }
      }
    } finally {
      busy = false;
    }
  }

  // Keep sheet-context in a tiny runtime ctx
  window.addEventListener('lm:sheet-context', (e) => {
    const d = e && e.detail;
    ctx = {
      spreadsheetId: d && d.spreadsheetId,
      // sheetGid is optional; if not present, fall back to materialsGid / defaultCaptionGid
      sheetGid: (d && (d.sheetGid ?? d.materialsGid ?? d.defaultCaptionGid)) ?? null,
    };
    console.log('[mat-sheet v2.2] sheet-context bound:', ctx.spreadsheetId, 'gid=', ctx.sheetGid);
    drain();
  });

  // Legacy event used by older orchestrators; safe no-op if never fired
  window.addEventListener('lm:mat-opacity', (e) => {
    const d = (e && e.detail) || {};
    if (d.materialKey == null || d.opacity == null) return;
    enqueue({
      updatedAt: d.updatedAt || new Date().toISOString(),
      updatedBy: d.updatedBy || 'ui',
      materialKey: d.materialKey,
      opacity: d.opacity,
    });
  });

  console.log('[mat-sheet v2.2] armed (bridge-only, no __LM_MATERIALS append)');
})();

// NOTE:
// The previous implementation here used __lm_fetchJSONAuth and appended rows
// directly into the __LM_MATERIALS sheet. That behaviour has been removed
// to enforce the design rule: "__LM_MATERIALS is header-only; do not append rows".
//
