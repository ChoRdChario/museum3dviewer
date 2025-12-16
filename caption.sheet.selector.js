// caption.sheet.selector.js — Phase A2: caption sheet select & create (gid-first)
(function () {
  const TAG = '[cap-sheet-select]';
  const log  = (...a) => console.log(TAG, ...a);
  const warn = (...a) => console.warn(TAG, ...a);
  const $ = (sel, root = document) => root.querySelector(sel);

  const CAPTION_HEADERS = [
    'id','title','body','color',
    'posX','posY','posZ',
    'imageFileId',
    'createdAt','updatedAt'
  ];

  // --- auth helper ----------------------------------------------------
  function getAuthFetch() {
    if (typeof window.__lm_fetchJSONAuth === 'function') {
      return window.__lm_fetchJSONAuth;
    }
    // fallback: token + fetch
    return async function authFetch(url, init) {
      let token = null;
      try {
        if (typeof window.ensureToken === 'function') {
          await window.ensureToken({ interactive: false });
        }
      } catch (_) {}
      if (typeof window.getAccessToken === 'function') {
        token = await window.getAccessToken();
      }
      if (!token) throw new Error('no auth token');

      const headers = Object.assign(
        {},
        (init && init.headers) || {},
        {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/json'
        }
      );
      // JSON bodyなら Content-Type を補う
      if (init && init.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }

      const res = await fetch(url, Object.assign({}, init, { headers }));
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`fetch failed ${res.status} ${text}`);
      }
      return res.json();
    };
  }

  // --- セレクトへ一覧を流し込む ---------------------------------------
  async function loadSheetsIntoSelect(spreadsheetId, activeGid) {
    const sel = $('#save-target-sheet');
    const btn = $('#save-target-create');
    if (!sel) return;

		// Avoid a brief flash of raw sheet titles (e.g. "シート1", "シート2") by
		// keeping the selector disabled while we resolve displayNames.
		sel.disabled = true;
		sel.innerHTML = '';
		const loadingOpt = document.createElement('option');
		loadingOpt.value = '';
		loadingOpt.textContent = 'Loading…';
		loadingOpt.selected = true;
		sel.appendChild(loadingOpt);

    const GM = window.LM_SHEET_GIDMAP;
    if (!GM || typeof GM.fetchSheetMap !== 'function') {
      warn('LM_SHEET_GIDMAP missing');
	      // Do not leave the selector in a disabled loading state.
	      sel.disabled = false;
	      sel.innerHTML = '';
	      const ph = document.createElement('option');
	      ph.value = '';
	      ph.textContent = 'Select sheet…';
	      ph.selected = true;
	      sel.appendChild(ph);
      return;
    }

    const map = await GM.fetchSheetMap(spreadsheetId);
    const entries = Object.entries(map.byId || {})
      .map(([gid, info]) => ({
        gid: Number(gid),
        title: info.title,
        index: info.index
      }))
      .filter(s => s.title && !/^__LM_/.test(s.title || '')) // __LM_ 系は除外
      .sort((a, b) => a.index - b.index);

	    // Best-effort: resolve displayName map before we build options, so we don't
	    // render raw sheet titles and then swap them later.
	    let gidToDisplayName = null;
	    try {
	      const getReg = window.__lm_getSheetNameRegistry;
	      if (typeof getReg === 'function') {
	        const reg = await getReg({ spreadsheetId });
	        if (reg && reg.gidToDisplayName && typeof reg.gidToDisplayName.get === 'function') {
	          gidToDisplayName = reg.gidToDisplayName;
	        }
	      }
	    } catch (e) {
	      warn('sheet name registry fetch failed', e);
	    }

	    // Replace the temporary "Loading..." option with a stable placeholder label.
	    // (We create/keep an option[value=""] so existing code paths remain safe,
	    //  but we don't want "Loading..." to persist after the list is populated.)
	    let placeholder = sel.querySelector('option[value=""]');
	    if (!placeholder) {
	      placeholder = document.createElement('option');
	      placeholder.value = '';
	    }
	    placeholder.textContent = 'Select sheet…';
	    placeholder.disabled = true;
	    placeholder.selected = false;

    sel.innerHTML = '';
    sel.appendChild(placeholder);

    const activeNum = (activeGid !== undefined && activeGid !== null && activeGid !== '')
      ? Number(activeGid)
      : null;

    let selectedValue = null;
	    for (const s of entries) {
      const opt = document.createElement('option');
      opt.value = String(s.gid);
	      const label = (gidToDisplayName && gidToDisplayName.get(String(s.gid)))
	        ? String(gidToDisplayName.get(String(s.gid)))
	        : String(s.title);
	      opt.textContent = label;
      // Keep actual tab title even if UI label is later replaced by displayName
      opt.dataset.sheetTitle = String(s.title || "");
	      // displayName is the UI label (may differ from the actual sheet title)
	      opt.dataset.displayName = label;
      sel.appendChild(opt);
      if (activeNum !== null && s.gid === activeNum) {
        selectedValue = opt.value;
      }
	    }

	    // Loading phase complete.
	    sel.disabled = false;

    // アクティブ gid が無い場合は先頭を選ぶ
    if (!selectedValue && entries.length > 0) {
      selectedValue = String(entries[0].gid);
    }

    sel.value = selectedValue || '';

    // The sheet list is rebuilt here (options are recreated). If the project uses
    // a "display name" stored in each sheet's Z1 (sheet-rename.module.js), we
    // must re-sync option labels after rebuilding, otherwise the UI falls back to
    // raw sheet titles.
	    try {
	      // Legacy compatibility: if we could not resolve displayNames here, fall back
	      // to the existing sync hook.
	      if (!gidToDisplayName || (gidToDisplayName.size === 0)) {
	        const fn = window.__lm_syncSheetDisplayNamesFromZ1;
	        if (typeof fn === 'function') {
	          await fn(spreadsheetId, entries, sel);
	        }
	      }
	    } catch (e) {
	      warn('display name sync failed', e);
	    }

    // rename UI 用のグローバル更新
    const gidStr = sel.value;
    window.currentSpreadsheetId = spreadsheetId || window.currentSpreadsheetId || '';
    window.currentSheetId = gidStr ? Number(gidStr) : null;
    const opt = gidStr && sel.selectedOptions && sel.selectedOptions[0];
    window.currentSheetDisplayName = opt ? (opt.textContent || "").trim() : "";
    window.currentSheetTitle = opt ? ((opt.dataset && opt.dataset.sheetTitle) ? String(opt.dataset.sheetTitle).trim() : (opt.textContent || "").trim()) : "";

    // シートが決まっていれば context に反映（ただし変わった時だけ）
    if (spreadsheetId && gidStr) {
      try {
        if (typeof window.setSheetContext === 'function') {
          window.setSheetContext({ spreadsheetId, sheetGid: gidStr });
        } else {
          window.dispatchEvent(new CustomEvent('lm:sheet-context', {
            detail: { spreadsheetId, sheetGid: gidStr }
          }));
        }
      } catch (e) {
        warn('setSheetContext in loadSheetsIntoSelect failed', e);
      }
    }

    // rename UI 側の wireSelectChange を起動させるために change を飛ばす
    sel.dispatchEvent(new Event('change', { bubbles: true }));

    if (btn) btn.disabled = !spreadsheetId;
    log('select populated', { spreadsheetId, activeGid: gidStr });
  }

  // --- 新規シート作成 --------------------------------------------------
  async function createNewSheet(spreadsheetId) {
    if (!spreadsheetId) return;
    const sel = $('#save-target-sheet');
    const count = sel ? (sel.options.length - 1 /* placeholder除く */) : 0;
    const defaultName = `シート${Math.max(2, count + 1)}`;
    const name = (window.prompt('New caption sheet name', defaultName) || '').trim();
    if (!name) return;

    const authFetch = getAuthFetch();

    // addSheet
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`;
    const payload = {
      requests: [
        {
          addSheet: {
            properties: {
              title: name,
              gridProperties: { frozenRowCount: 1 }
            }
          }
        }
      ]
    };
    const res = await authFetch(url, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const props = res &&
      res.replies &&
      res.replies[0] &&
      res.replies[0].addSheet &&
      res.replies[0].addSheet.properties;

    if (!props || props.sheetId == null) {
      throw new Error('addSheet returned no properties');
    }
    const gid = props.sheetId;

    // header 書き込み
    const rangeA1 = `${name}!A1:J1`;
    const encRange = encodeURIComponent(rangeA1);
    const headerUrl =
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encRange}?valueInputOption=RAW`;
    const body = {
      range: rangeA1,
      values: [CAPTION_HEADERS]
    };
    await authFetch(headerUrl, {
      method: 'PUT',
      body: JSON.stringify(body)
    });

    
    // Sheet name registry (best-effort)
    try {
      if (window.__lm_upsertSheetNameRegistry) {
        await window.__lm_upsertSheetNameRegistry(spreadsheetId, String(gid), name, name);
      }
    } catch (e) {
      console.warn('[cap-sheet-select] registry upsert failed', e);
    }
// gid マップを更新してから select を再構築
    try {
      window.LM_SHEET_GIDMAP &&
        window.LM_SHEET_GIDMAP.invalidateMap &&
        window.LM_SHEET_GIDMAP.invalidateMap(spreadsheetId);
    } catch (e) {
      warn('invalidateMap failed', e);
    }

    await loadSheetsIntoSelect(spreadsheetId, String(gid));
    log('sheet created', { spreadsheetId, gid, name });
  }

  // --- 起動処理 --------------------------------------------------------
  function boot() {
    const sel = document.getElementById('save-target-sheet');
    const btn = document.getElementById('save-target-create');
    if (!sel || !btn) {
      // UI が存在しないなら何もしない
      return;
    }

    // Create ボタン
    btn.addEventListener('click', async () => {
      try {
        const spreadsheetId =
          window.__LM_ACTIVE_SPREADSHEET_ID ||
          window.currentSpreadsheetId ||
          '';
        if (!spreadsheetId) return;
        await createNewSheet(spreadsheetId);
      } catch (e) {
        warn('createNewSheet failed', e);
      }
    });

    // セレクト変更 -> sheet-context 更新
    sel.addEventListener('change', () => {
      const spreadsheetId =
        window.__LM_ACTIVE_SPREADSHEET_ID ||
        window.currentSpreadsheetId ||
        '';
      const gidStr = sel.value || '';
      if (!spreadsheetId || !gidStr) return;
      try {
        if (typeof window.setSheetContext === 'function') {
          window.setSheetContext({ spreadsheetId, sheetGid: gidStr });
        } else {
          window.dispatchEvent(new CustomEvent('lm:sheet-context', {
            detail: { spreadsheetId, sheetGid: gidStr }
          }));
        }
      } catch (e) {
        warn('setSheetContext on change failed', e);
      }
    }, { passive: true });

    // lm:sheet-context から一覧を再構築
    window.addEventListener('lm:sheet-context', (ev) => {
      const d = (ev && ev.detail) || {};
      const sid = d.spreadsheetId || window.__LM_ACTIVE_SPREADSHEET_ID || '';
      const gid = d.sheetGid || window.__LM_ACTIVE_SHEET_GID || '';
      if (!sid) return;
      loadSheetsIntoSelect(sid, gid);
    });

    // すでに ctx が決まっている場合は初期 populate
    const sid = window.__LM_ACTIVE_SPREADSHEET_ID || '';
    const gid = window.__LM_ACTIVE_SHEET_GID || '';
    if (sid) {
      loadSheetsIntoSelect(sid, gid);
    }

    log('ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
