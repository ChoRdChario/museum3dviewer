/*! sheet-rename.module.js — v3 (display-name via Z1, gid-first, __lm_fetchJSONAuth) */
(function () {
  const DEBUG =
    /\bdebug=1\b/.test(location.search) || window.SHEET_RENAME_DEBUG;
  const log = (...a) => {
    if (DEBUG) console.log("[renameUI]", ...a);
  };
  const warn = (...a) => {
    if (DEBUG) console.warn("[renameUI]", ...a);
  };

  // --- small helpers ---------------------------------------------------
  function $(id) {
    return document.getElementById(id);
  }

  function findSheetSelect() {
    return (
      $("save-target-sheet") ||
      $("sheet-select") ||
      document.querySelector(
        "#save-target-sheet select, #sheet-select select, .lm-panel-caption select, #captions select, .right-panel select"
      ) ||
      null
    );
  }

  function ensureWrapperForSelect(sel) {
    if (!sel || !sel.parentNode) return null;
    let host =
      $("save-target-sheet-wrapper") || $("sheet-select-wrapper");
    if (host) return host;
    host = document.createElement("div");
    host.id =
      sel.id === "save-target-sheet"
        ? "save-target-sheet-wrapper"
        : "sheet-select-wrapper";
    host.style.display = "flex";
    host.style.alignItems = "center";
    host.style.gap = "4px";
    sel.parentNode.insertBefore(host, sel);
    host.appendChild(sel);
    return host;
  }

  function listSheetsFromDOM(sel) {
    const out = [];
    if (!sel) return out;
    for (const opt of Array.from(sel.options || [])) {
      const id = opt.value ? Number(opt.value) : null;
      out.push({ sheetId: id, title: (opt.textContent || "").trim() });
    }
    return out;
  }

  function updateOptionTextAndDataset(opt, title) {
    if (!opt) return;
    opt.textContent = title;
    if (!opt.dataset) opt.dataset = {};
    // dataset.title は「UI上の名前」（表示名）として扱う
    opt.dataset.title = title;
  }

  // --- view state ------------------------------------------------------
  function updateSheetRenameView(mode) {
    const label = $("sheet-rename-label");
    const input = $("sheet-rename-input");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const edit = $("sheet-rename-edit");
    const spin = $("sheet-rename-spin");
    if (!input || !ok || !cancel || !edit || !spin) return;

    const title = (window.currentSheetTitle || "").trim();

    if (mode === "edit") {
      if (label) label.style.display = "none";
      input.style.display = "inline-block";
      ok.style.display = "inline-block";
      cancel.style.display = "inline-block";
      edit.style.display = "none";
      spin.style.display = "none";
      input.value = title || "";
      input.focus();
      input.select();
    } else if (mode === "busy") {
      if (label) label.style.display = "none";
      input.style.display = "none";
      ok.style.display = "none";
      cancel.style.display = "none";
      edit.style.display = "none";
      spin.style.display = "inline-block";
    } else {
      // view モードでもラベルは表示しない（ドロップダウン側の表示を優先）
      if (label) label.style.display = "none";
      input.style.display = "none";
      ok.style.display = "none";
      cancel.style.display = "none";
      edit.style.display = "inline-block";
      spin.style.display = "none";
      // label.textContent = title || "(no sheet)"; // hidden anyway
    }
  }

  function wireSelectChange() {
    const sel = findSheetSelect();
    if (!sel) return;
    const syncFromSelect = () => {
      const opt =
        (sel.selectedOptions && sel.selectedOptions[0]) ||
        sel.options[sel.selectedIndex] ||
        null;
      const title =
        opt && opt.textContent ? opt.textContent.trim() : "";
      const id = opt && opt.value ? Number(opt.value) : null;

      if (id != null && !Number.isNaN(id)) {
        window.currentSheetId = id;
      } else {
        window.currentSheetId = null;
      }
      if (title) window.currentSheetTitle = title;

      sel.title = title || "";

      const label = $("sheet-rename-label");
      const edit = $("sheet-rename-edit");
      if (label) label.textContent = title || "(no sheet)";
      if (edit) edit.disabled = !(window.currentSheetId != null);
    };

    syncFromSelect();
    sel.addEventListener("change", syncFromSelect, { passive: true });
    new MutationObserver(syncFromSelect).observe(sel, {
      childList: true,
      subtree: true,
    });
  }

  // --- auth helper (unified with A系) ----------------------------------
  async function getAuthFetchAndToken() {
    // 1) __lm_fetchJSONAuth があればそれを最優先（token 内部取得）
    if (typeof window.__lm_fetchJSONAuth === "function") {
      return { authFetch: window.__lm_fetchJSONAuth, token: null };
    }

    // 2) 旧来の ensureToken + getAccessToken で token を取る
    let token = null;

    // silent
    try {
      if (typeof window.ensureToken === "function") {
        await window.ensureToken({ interactive: false });
      }
      if (typeof window.getAccessToken === "function") {
        token = await window.getAccessToken();
      }
    } catch (_) {}

    // interactive
    if (!token) {
      try {
        if (typeof window.ensureToken === "function") {
          await window.ensureToken({ interactive: true });
        }
        if (typeof window.getAccessToken === "function") {
          token = await window.getAccessToken();
        }
      } catch (_) {}
    }

    if (!token) {
      throw new Error("no token");
    }

    const authFetch = async (url, init) => {
      const headers = Object.assign(
        {},
        (init && init.headers) || {},
        {
          Authorization: "Bearer " + token,
          Accept: "application/json",
        }
      );
      if (init && init.body && !headers["Content-Type"]) {
        headers["Content-Type"] = "application/json";
      }
      const res = await fetch(url, Object.assign({}, init, { headers }));
      if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Sheets API ${res.status}: ${text}`);
      }
      try {
        return await res.json();
      } catch {
        return null;
      }
    };

    return { authFetch, token };
  }

  // --- Sheets helper: display-name via Z1 -------------------------------
  const SHEETS_ROOT = "https://sheets.googleapis.com/v4/spreadsheets";

  function buildRange(sheetTitle, a1) {
    const safeTitle = String(sheetTitle || "").replace(/'/g, "''");
    return `'${safeTitle}'!${a1}`;
  }

  // Z1 に表示名を書き込む
  async function sheetsPutDisplayName(
    spreadsheetId,
    sheetId,
    newTitle,
    authFetch,
    token
  ) {
    const NS = window.LM_SHEET_GIDMAP;
    if (!NS || typeof NS.fetchSheetMap !== "function") {
      throw new Error("LM_SHEET_GIDMAP not available");
    }
    const map = await NS.fetchSheetMap(spreadsheetId);
    const byId = map && map.byId;
    const meta = byId && byId[Number(sheetId)];
    const sheetTitle = meta && meta.title;
    if (!sheetTitle) {
      throw new Error("sheet title not found for gid " + sheetId);
    }

    const range = buildRange(sheetTitle, "Z1");
    const url =
      SHEETS_ROOT +
      "/" +
      encodeURIComponent(spreadsheetId) +
      "/values/" +
      encodeURIComponent(range) +
      "?valueInputOption=RAW";

    const body = {
      values: [[newTitle]],
    };

    if (typeof authFetch === "function") {
      return authFetch(url, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }

    // 念のためのフォールバック
    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(url, {
      method: "PUT",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Sheets API ${res.status}: ${text}`);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // Z1 から表示名を一括で読み、ドロップダウンに反映
  // spreadsheetIdOverride / selectElOverride は、他モジュールが <select> を再構築した直後に
  // 再同期させたいケース向け。
  async function syncDisplayNamesFromZ1(spreadsheetIdOverride, selectElOverride) {
    const sel = selectElOverride || findSheetSelect();
    if (!sel) return;

    let spreadsheetId =
      (spreadsheetIdOverride || "") ||
      window.__LM_ACTIVE_SPREADSHEET_ID ||
      window.currentSpreadsheetId ||
      "";

    // ctx.bridge が少し遅れるケースに備えて短時間だけ待つ
    if (!spreadsheetId) {
      for (let t = 0; t < 5 && !spreadsheetId; t++) {
        await new Promise((r) => setTimeout(r, 60));
        spreadsheetId =
          window.__LM_ACTIVE_SPREADSHEET_ID ||
          window.currentSpreadsheetId ||
          "";
      }
    }
    if (!spreadsheetId) {
      warn("syncDisplayNamesFromZ1: spreadsheetId missing");
      return;
    }

    const NS = window.LM_SHEET_GIDMAP;
    if (!NS || typeof NS.fetchSheetMap !== "function") {
      warn("syncDisplayNamesFromZ1: LM_SHEET_GIDMAP not available");
      return;
    }

    try {
      const { authFetch, token } = await getAuthFetchAndToken();
      const map = await NS.fetchSheetMap(spreadsheetId);
      const byId = map && map.byId;
      if (!byId) return;

      const ranges = [];
      const gidForRange = [];

      for (const [gidStr, meta] of Object.entries(byId)) {
        const gid = Number(gidStr);
        if (!meta || !meta.title) continue;
        const range = buildRange(meta.title, "Z1");
        ranges.push(range);
        gidForRange.push(gid);
      }

      if (!ranges.length) return;

      const qs = ranges
        .map((r) => "ranges=" + encodeURIComponent(r))
        .join("&");
      const url =
        SHEETS_ROOT +
        "/" +
        encodeURIComponent(spreadsheetId) +
        "/values:batchGet?" +
        qs;

      const json = await authFetch(url, {});
      const result = {};
      const vr = (json && json.valueRanges) || [];

      // range: "'シート2'!Z1" の形式
      for (const item of vr) {
        const range = item.range || "";
        const values = item.values || [];
        const val =
          values[0] && values[0][0] != null ? String(values[0][0]) : "";
        if (!val) continue;

        let sheetTitle = null;
        const m = range.match(/^'(.+)'!/);
        if (m) {
          sheetTitle = m[1].replace(/''/g, "'");
        } else {
          const idx = range.indexOf("!");
          sheetTitle = idx >= 0 ? range.slice(0, idx) : range;
        }

        if (!sheetTitle) continue;

        // 対応する gid を探す
        for (const [gidStr, meta] of Object.entries(byId)) {
          if (meta && meta.title === sheetTitle) {
            result[Number(gidStr)] = val;
            break;
          }
        }
      }

      // DOM に反映
      for (const opt of Array.from(sel.options || [])) {
        if (!opt.value) continue;
        const gid = Number(opt.value);
        if (Number.isNaN(gid)) continue;
        const name = result[gid];
        if (name) {
          updateOptionTextAndDataset(opt, name);
        }
      }

      // currentSheetTitle / label も更新
      const currentOpt =
        (sel.selectedOptions && sel.selectedOptions[0]) ||
        sel.options[sel.selectedIndex] ||
        null;
      if (currentOpt && currentOpt.textContent) {
        window.currentSheetTitle = currentOpt.textContent.trim();
        const label = $("sheet-rename-label");
        if (label) label.textContent = window.currentSheetTitle;
      }

      log("display-names synced from Z1");
    } catch (e) {
      warn("syncDisplayNamesFromZ1 failed", e);
    }
  }

  // Expose for other modules (e.g., caption.sheet.selector.js) to re-sync display names
  // after rebuilding the <select> options.
  try {
    window.__lm_syncSheetDisplayNamesFromZ1 = syncDisplayNamesFromZ1;
  } catch (e) {
    // ignore
  }

  // --- legacy: real title rename (現在は未使用) -------------------------
  async function sheetsUpdateTitle(
    spreadsheetId,
    sheetId,
    newTitle,
    authFetch,
    token
  ) {
    // 互換性のために残しているが、現在は呼び出さない
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}:batchUpdate`;
    const body = {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId: Number(sheetId),
              title: newTitle,
            },
            fields: "title",
          },
        },
      ],
    };

    if (typeof authFetch === "function") {
      return authFetch(url, {
        method: "POST",
        body: JSON.stringify(body),
      });
    }

    const headers = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Sheets API ${res.status}: ${text}`);
    }
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  // --- applySheetRename (Z1 display-name版) -----------------------------
  async function applySheetRename() {
    const input = $("sheet-rename-input");
    const spin = $("sheet-rename-spin");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const label = $("sheet-rename-label");
    const sel = findSheetSelect();
    if (!input || !spin || !ok || !cancel || !label || !sel) return;

    if (window.currentSheetId == null) {
      wireSelectChange();
      if (window.currentSheetId == null) return;
    }

    const before = window.currentSheetTitle || "";
    const newTitle = (input.value || "").trim();
    const opt = sel.querySelector(
      `option[value="${window.currentSheetId}"]`
    );

    // 不正 or 変更なし or 長すぎる → 何もしない
    if (!newTitle || newTitle === before || newTitle.length > 100) {
      updateSheetRenameView("view");
      return;
    }

    // 表示名としての重複チェック（実シート名とは無関係）
    for (const o of Array.from(sel.options || [])) {
      if ((o.textContent || "").trim() === newTitle) {
        updateSheetRenameView("view");
        return;
      }
    }

    // 楽観的 UI 更新
    label.textContent = newTitle;
    if (opt) updateOptionTextAndDataset(opt, newTitle);
    window.currentSheetTitle = newTitle;
    updateSheetRenameView("view");

    // spreadsheetId を __LM_ACTIVE_SPREADSHEET_ID 優先で取得
    let spreadsheetId =
      window.__LM_ACTIVE_SPREADSHEET_ID ||
      window.currentSpreadsheetId ||
      "";

    // ctx.bridge が少し遅れるケースに備えて短時間だけ待つ
    if (!spreadsheetId) {
      for (let t = 0; t < 5 && !spreadsheetId; t++) {
        await new Promise((r) => setTimeout(r, 60));
        spreadsheetId =
          window.__LM_ACTIVE_SPREADSHEET_ID ||
          window.currentSpreadsheetId ||
          "";
      }
    }

    if (!spreadsheetId) {
      // 失敗したらロールバック
      label.textContent = before;
      if (opt) updateOptionTextAndDataset(opt, before);
      window.currentSheetTitle = before;
      warn("rename failed", new Error("spreadsheetId missing"));
      return;
    }

    // API 呼び出し (Z1 書き込み)
    try {
      input.disabled = ok.disabled = cancel.disabled = true;
      spin.style.display = "inline-block";

      const { authFetch, token } = await getAuthFetchAndToken();
      await sheetsPutDisplayName(
        spreadsheetId,
        window.currentSheetId,
        newTitle,
        authFetch,
        token
      );

      // 成功時は currentSheetTitle / option は既に newTitle になっているので何もしない
      log("rename success (Z1 display-name)", newTitle);
    } catch (e) {
      // 失敗したらロールバック
      label.textContent = before;
      if (opt) updateOptionTextAndDataset(opt, before);
      window.currentSheetTitle = before;
      warn("rename failed", e);
    } finally {
      input.disabled = ok.disabled = cancel.disabled = false;
      spin.style.display = "none";
    }
  }

  // --- UI events -------------------------------------------------------
  function wireSheetRenameEvents() {
    const label = $("sheet-rename-label");
    const input = $("sheet-rename-input");
    const ok = $("sheet-rename-ok");
    const cancel = $("sheet-rename-cancel");
    const edit = $("sheet-rename-edit");

    if (!label || !input || !ok || !cancel || !edit) return;

    edit.addEventListener(
      "click",
      () => {
        if (!(window.currentSheetId != null)) return;
        updateSheetRenameView("edit");
      },
      { passive: true }
    );

    label.addEventListener(
      "click",
      () => {
        if (!(window.currentSheetId != null)) return;
        updateSheetRenameView("edit");
      },
      { passive: true }
    );

    cancel.addEventListener(
      "click",
      () => {
        updateSheetRenameView("view");
      },
      { passive: true }
    );

    ok.addEventListener(
      "click",
      () => {
        applySheetRename();
      },
      { passive: true }
    );

    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        applySheetRename();
      } else if (ev.key === "Escape") {
        ev.preventDefault();
        updateSheetRenameView("view");
      }
    });
  }

  // --- UI mount --------------------------------------------------------
  function mountSheetRenameUI() {
    const sel = findSheetSelect();
    if (!sel || !sel.parentNode) return false;

    const host = ensureWrapperForSelect(sel);
    if (!host) return false;
    if ($("sheet-rename-root")) return true;

    const root = document.createElement("div");
    root.id = "sheet-rename-root";
    root.className = "sheet-rename-ui";
    root.style.display = "inline-flex";
    root.style.alignItems = "center";
    root.style.gap = "4px";
    root.innerHTML = [
      '<button id="sheet-rename-edit" class="sr-btn sr-edit" type="button" title="Rename sheet">✎</button>',
      '<span id="sheet-rename-label" class="sr-label">(no sheet)</span>',
      '<input id="sheet-rename-input" class="sr-input" type="text" style="display:none;max-width:160px;">',
      '<button id="sheet-rename-ok" class="sr-btn sr-ok" type="button" title="Apply" style="display:none;">✓</button>',
      '<button id="sheet-rename-cancel" class="sr-btn sr-cancel" type="button" title="Cancel" style="display:none;">×</button>',
      '<span id="sheet-rename-spin" class="sr-spin" aria-hidden="true" style="display:none;">⏳</span>',
    ].join("");

    host.appendChild(root);
    wireSheetRenameEvents();
    wireSelectChange();
    updateSheetRenameView("view");
    // シート一覧と gid → title のマップが揃った後、Z1 から表示名を同期
    syncDisplayNamesFromZ1();
    log("UI mounted");
    return true;
  }

  // --- auto-mount ------------------------------------------------------
  (function autoMount() {
    if (mountSheetRenameUI()) return;
    const mo = new MutationObserver(() => {
      if (mountSheetRenameUI()) mo.disconnect();
    });
    mo.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
    });
    let tries = 30;
    const tm = setInterval(() => {
      if (mountSheetRenameUI() || --tries <= 0) clearInterval(tm);
    }, 200);
  })();

  // optional export for manual re-mount
  window.mountSheetRenameUI = mountSheetRenameUI;
})();