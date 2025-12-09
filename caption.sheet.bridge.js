(function () {
  const TAG = "[caption.sheet.bridge]";

  // A1:J1
  const HEADER = [
    "id",
    "title",
    "body",
    "color",
    "posX",
    "posY",
    "posZ",
    "imageFileId",
    "createdAt",
    "updatedAt",
  ];

  function getSheetContext() {
    return window.__lm_sheet_ctx || null;
  }

  async function ensureToken() {
    // In the new auth model, token management is handled by auth.fetch.bridge.js.
    // This bridge only needs to ensure that the global fetch wrapper exists.
    const fetchAuth = window.__lm_fetchJSONAuth;
    if (typeof fetchAuth !== "function") {
      console.warn(TAG, "__lm_fetchJSONAuth not ready");
      return null;
    }
    // We do not need the token value itself here; the wrapper acquires it lazily.
    return "ok";
  }

  // Delegate to the global auth bridge (installed by auth.fetch.bridge.js)
  async function __lm_fetchJSONAuth(url, options) {
    const fetchAuth = window.__lm_fetchJSONAuth;
    if (typeof fetchAuth !== "function") {
      console.warn(TAG, "__lm_fetchJSONAuth not ready");
      throw new Error("__lm_fetchJSONAuth not ready");
    }
    return fetchAuth(url, options);
  }

  function buildSheetUrl(spreadsheetId, path) {
    return (
      "https://sheets.googleapis.com/v4/spreadsheets/" +
      encodeURIComponent(spreadsheetId) +
      "/" +
      path
    );
  }

  function buildValuesUrl(spreadsheetId, sheetTitle, range) {
    const base = buildSheetUrl(spreadsheetId, "values/");
    const encoded = encodeURIComponent(sheetTitle + "!" + range);
    return base + encoded;
  }

  async function putHeaderRow(spreadsheetId, sheetTitle) {
    const token = await ensureToken();
    if (!token) throw new Error("no token for putHeaderRow");

    const url = buildValuesUrl(spreadsheetId, sheetTitle, "A1:J1");

    const body = {
      range: sheetTitle + "!A1:J1",
      majorDimension: "ROWS",
      values: [HEADER],
    };

    console.log(TAG, "header put", sheetTitle + "!A1:J1");

    await __lm_fetchJSONAuth(url + "?valueInputOption=RAW", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  async function listRows(spreadsheetId, sheetTitle) {
    const token = await ensureToken();
    if (!token) throw new Error("no token for listRows");

    const url = buildValuesUrl(spreadsheetId, sheetTitle, "A2:J1000");

    const data = await __lm_fetchJSONAuth(url, {
      method: "GET",
    });

    const rows = (data.values || []).map((cols) => {
      const obj = {};
      HEADER.forEach((key, idx) => {
        obj[key] = cols[idx] || "";
      });
      return obj;
    });

    return rows;
  }

  async function appendRow(spreadsheetId, sheetTitle, item) {
    const token = await ensureToken();
    if (!token) throw new Error("no token for appendRow");

    const url = buildValuesUrl(spreadsheetId, sheetTitle, "A2:J2");

    const row = HEADER.map((key) => item[key] || "");

    const body = {
      range: sheetTitle + "!A2:J2",
      majorDimension: "ROWS",
      values: [row],
    };

    const data = await __lm_fetchJSONAuth(
      url + "?valueInputOption=RAW&insertDataOption=INSERT_ROWS",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }
    );

    const updatedRange = data.updates && data.updates.updatedRange;
    const m =
      updatedRange &&
      updatedRange.match(/!A(\d+):J(\d+)/);
    const rowIndex = m ? parseInt(m[1], 10) : null;

    console.log(TAG, "append row", item.id, "row", rowIndex);

    return rowIndex;
  }

  async function deleteRow(spreadsheetId, sheetId, rowIndex) {
    const token = await ensureToken();
    if (!token) throw new Error("no token for deleteRow");

    const url = buildSheetUrl(spreadsheetId, ":batchUpdate");

    const body = {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    };

    console.log(TAG, "delete row index", rowIndex, "sheetId", sheetId);

    await __lm_fetchJSONAuth(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  }

  // ────────────────────────────────────────────────
  // Caption UI との連携
  // ────────────────────────────────────────────────

  function waitCaptionUI() {
    return new Promise((resolve) => {
      if (window.__LM_CAPTION_UI) {
        return resolve(window.__LM_CAPTION_UI);
      }
      let tries = 0;
      const timer = setInterval(() => {
        if (window.__LM_CAPTION_UI) {
          clearInterval(timer);
          resolve(window.__LM_CAPTION_UI);
        } else if (++tries > 50) {
          clearInterval(timer);
          console.warn(TAG, "caption UI not ready");
          resolve(null);
        }
      }, 200);
    });
  }

  async function handleSheetContext(ctx) {
    const spreadsheetId = ctx.spreadsheetId;
    const sheetGid = ctx.sheetGid;
    const sheetTitle = ctx.sheetTitle || "シート1";

    await putHeaderRow(spreadsheetId, sheetTitle);

    const rows = await listRows(spreadsheetId, sheetTitle);

    const ui = await waitCaptionUI();
    if (!ui) return;

    ui.setItemsFromSheet(rows);

    ui.onItemAdded = async (item) => {
      const rowIndex = await appendRow(spreadsheetId, sheetTitle, item);
      item._rowIndex = rowIndex;
    };

    ui.onItemDeleted = async (item) => {
      if (!item._rowIndex) {
        console.warn(TAG, "no rowIndex for delete", item.id);
        return;
      }
      await deleteRow(spreadsheetId, sheetGid, item._rowIndex);
    };
  }

  window.addEventListener("lm:sheet-context", async (ev) => {
    const ctx = ev.detail;
    console.log(TAG, "sheet-context", ctx);
    try {
      await handleSheetContext(ctx);
    } catch (err) {
      console.error(TAG, "sheet-context error", err);
    }
  });

  window.__LM_CAPTION_SHEET_BRIDGE__ = {
    __ver: "A2",
    listRows,
    appendRow,
    deleteRow,
  };

  console.log(TAG, "armed");
})();
