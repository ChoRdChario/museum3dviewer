/*! sheet-rename.module.js — v2 (gid-first + __LM_ACTIVE_SPREADSHEET_ID + __lm_fetchJSONAuth) */
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
    if (!label || !input || !ok || !cancel || !edit || !spin) return;

    const title = (window.currentSheetTitle || "").trim();

    if (mode === "edit") {
      label.style.display = "none";
      input.style.display = "inline-block";
      ok.style.display = "inline-block";
      cancel.style.display = "inline-block";
      edit.style.display = "none";
      spin.style.display = "none";
      input.value = title || "";
      input.focus();
      input.select();
    } else {
      label.style.display = "inline-block";
      input.style.display = "none";
      ok.style.display = "none";
      cancel.style.display = "none";
      edit.style.display = "inline-block";
      spin.style.display = "none";
      label.textContent = title || "(no sheet)";
    }
  }

  function wireSelectChange() {
    const sel = findSheetSelect();
    if (!sel) return;
    const syncFromSelect = () => {
      const opt =
        (sel.selectedOptions && sel.selectedOptions[0]) || sel.options[sel.selectedIndex] || null;
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
    let triedInteractive = false;

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
        triedInteractive = true;
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

  // --- core: Sheets rename ---------------------------------------------
  async function sheetsUpdateTitle(
    spreadsheetId,
    sheetId,
    newTitle,
    authFetch,
    token
  ) {
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

    // 念のためのフォールバック（ほぼ来ない想定）
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

  // --- applySheetRename (統一版) ---------------------------------------
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

    // 重複チェック
    for (const o of Array.from(sel.options || [])) {
      if ((o.textContent || "").trim() === newTitle) {
        updateSheetRenameView("view");
        return;
      }
    }

    // 楽観的 UI 更新
    label.textContent = newTitle;
    if (opt) updateOptionTextAndDataset(opt, newTitle);
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
      label.textContent = before;
      if (opt) updateOptionTextAndDataset(opt, before);
      window.currentSheetTitle = before;
      warn("rename failed", new Error("spreadsheetId missing"));
      return;
    }

    // API 呼び出し
    try {
      input.disabled = ok.disabled = cancel.disabled = true;
      spin.style.display = "inline-block";

      const { authFetch, token } = await getAuthFetchAndToken();
      await sheetsUpdateTitle(
        spreadsheetId,
        window.currentSheetId,
        newTitle,
        authFetch,
        token
      );

      window.currentSheetTitle = newTitle;
      if (opt) updateOptionTextAndDataset(opt, newTitle);
      // 他の UI が sheet title を index 用に使っている可能性に配慮
      try {
        if (typeof window.ensureIndex === "function") {
          window.ensureIndex();
        }
      } catch (_) {}
      log("rename success", newTitle);
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
