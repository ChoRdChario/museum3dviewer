// ui.js — robust UI wiring for viewer + Drive fetch
// Exports: setupUI(app)
// - Guards all querySelectors
// - Disables load until signed-in (if auth present)
// - Loads GLB from Google Drive (v3) or local file input
// - Wires material controls to viewer API (setHSL, setOpacity, setUnlit, setDoubleSide, setWhiteKeyEnabled, setWhiteKeyThreshold)

export function setupUI(app) {
  console.log('[ui] setupUI start');
  const q = (sel) => document.querySelector(sel);

  // ---- elements (all optional; wiring only if present) ----
  const btnLoad   = q('#btnLoad');
  const inDriveId = q('#inputDriveId');
  const inFile    = q('#inputFile');

  const rngHue    = q('#mat-hue');
  const rngSat    = q('#mat-sat');
  const rngLig    = q('#mat-light');
  const rngOpacity= q('#mat-opacity');
  const btnUnlit  = q('#btn-unlit');
  const chkDouble = q('#mat-double');
  const chkWkEn   = q('#whitekey-enable');
  const rngWkTh   = q('#whitekey-thresh');

  // small helpers
  const hasToken = () => {
    // accept any of these shapes:
    // - app.auth.accessToken (string)
    // - app.auth.getAccessToken() (fn)
    try {
      if (app && app.auth) {
        if (typeof app.auth.getAccessToken === 'function') return !!app.auth.getAccessToken();
        if ('accessToken' in app.auth) return !!app.auth.accessToken;
      }
    } catch (e) {}
    return false;
  };
  const bearer = () => {
    if (app && app.auth) {
      if (typeof app.auth.getAccessToken === 'function') return app.auth.getAccessToken();
      if ('accessToken' in app.auth) return app.auth.accessToken;
    }
    return null;
  };

  const setLoadDisabled = (disabled) => {
    if (btnLoad) btnLoad.disabled = !!disabled;
  };

  // reflect auth state if available
  try {
    if (app && app.auth && typeof app.auth.onChange === 'function') {
      app.auth.onChange((state) => {
        setLoadDisabled(!hasToken());
      });
    }
  } catch (e) {
    // ignore
  }
  // initial
  setLoadDisabled(hasToken ? !hasToken() : false);

  // ---- Drive fetcher (uses Drive v3 files.get alt=media) ----
  async function fetchDriveArrayBuffer(fileId) {
    if (!hasToken()) {
      console.warn('[ui] blocked: not signed in');
      throw new Error('Not signed in. Click "Sign in" first.');
    }
    if (!fileId) throw new Error('No Drive file ID.');

    const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`;
    const token = bearer();
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Drive fetch failed: ${res.status} ${res.statusText} ${text}`);
    }
    return await res.arrayBuffer();
  }

  // ---- loaders ----
  if (btnLoad) {
    btnLoad.addEventListener('click', async () => {
      try {
        // prefer local file if chosen, else Drive ID
        if (inFile && inFile.files && inFile.files[0]) {
          const buf = await inFile.files[0].arrayBuffer();
          await app.viewer.loadGLBFromArrayBuffer(buf);
          console.log('[ui] loaded local GLB');
          return;
        }
        const id = inDriveId && inDriveId.value.trim();
        if (!id) {
          alert('Drive ID またはローカルGLBを指定してください。');
          return;
        }
        const buf = await fetchDriveArrayBuffer(id);
        await app.viewer.loadGLBFromArrayBuffer(buf);
        console.log('[ui] loaded Drive GLB', id);
      } catch (err) {
        console.error('[ui] failed to load', err);
        alert(err?.message || String(err));
      }
    });
  }

  // ---- material controls ----
  function applyHSL() {
    if (!app?.viewer?.setHSL) return;
    const h = rngHue ? Number(rngHue.value) : 0;
    const s = rngSat ? Number(rngSat.value) : 0;
    const l = rngLig ? Number(rngLig.value) : 0;
    app.viewer.setHSL(h, s, l);
  }
  if (rngHue)    rngHue.addEventListener('input', applyHSL);
  if (rngSat)    rngSat.addEventListener('input', applyHSL);
  if (rngLig)    rngLig.addEventListener('input', applyHSL);

  if (rngOpacity && app?.viewer?.setOpacity) {
    rngOpacity.addEventListener('input', () => {
      const v = Number(rngOpacity.value);
      app.viewer.setOpacity(v);
    });
  }

  if (btnUnlit && app?.viewer?.setUnlit) {
    btnUnlit.addEventListener('click', () => {
      // toggle: if data-state cached on the button, flip it; else ask viewer for current?
      const next = btnUnlit.dataset.state === '1' ? 0 : 1;
      btnUnlit.dataset.state = String(next);
      app.viewer.setUnlit(!!next);
    });
  }

  if (chkDouble && app?.viewer?.setDoubleSide) {
    chkDouble.addEventListener('change', () => {
      app.viewer.setDoubleSide(!!chkDouble.checked);
    });
  }

  if (chkWkEn && app?.viewer?.setWhiteKeyEnabled) {
    chkWkEn.addEventListener('change', () => {
      app.viewer.setWhiteKeyEnabled(!!chkWkEn.checked);
    });
  }

  if (rngWkTh && app?.viewer?.setWhiteKeyThreshold) {
    rngWkTh.addEventListener('input', () => {
      app.viewer.setWhiteKeyThreshold(Number(rngWkTh.value));
    });
  }

  console.log('[ui] setupUI done');
}
