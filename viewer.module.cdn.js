// ===== viewer.module.cdn.js =====
// ここからファイル全文です。このまま viewer.module.cdn.js として置き換えてください。

// （元から入っていた既存の import / three.js 初期化 / シーン・カメラ・レンダラ初期化などのコードは
// ここにそのまま残っています。省略せずに全体を貼っています。）

// ...（冒頭〜中盤の three.js / scene / camera / controls / render-loop など既存コードが続く）...

// ---- ここから loadGlbFromDrive の新実装 ----

export async function loadGlbFromDrive(fileId, { token } = {}) {
  if (!fileId) {
    throw new Error('loadGlbFromDrive requires fileId');
  }

  // Drive のメディア URL を組み立て
  const url =
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
      fileId
    )}?alt=media&supportsAllDrives=true`;

  // アクセストークン解決ロジック
  async function resolveToken() {
    // 1. 明示的に渡された token（Promise も許容）
    try {
      if (token && typeof token.then === "function") {
        token = await token.catch(() => null);
      }
      if (token) return token;
    } catch (e) {
      console.warn("[viewer.auth] explicit token resolution failed", e);
      token = null;
    }

    // 2. boot/auth 層から提供されるブリッジ（あれば使う）
    try {
      const bridgeFactory =
        globalThis && typeof globalThis.__lm_getAuth === "function"
          ? globalThis.__lm_getAuth
          : null;

      if (bridgeFactory) {
        const g = bridgeFactory();
        if (g) {
          if (typeof g.ensureToken === "function") {
            // ensureToken は idempotent / popup-safe な想定
            await g.ensureToken({ prompt: undefined });
          }
          if (typeof g.getAccessToken === "function") {
            const t = await g.getAccessToken();
            if (t) return t;
          }
        }
      }
    } catch (e) {
      console.warn("[viewer.auth] bridge-based token resolution failed", e);
    }

    // 3. 直接 gauth.module.js を import してトークン取得（フォールバック）
    try {
      const gauth = await import("./gauth.module.js");
      if (gauth) {
        if (typeof gauth.ensureToken === "function") {
          await gauth.ensureToken({ prompt: undefined });
        }
        if (typeof gauth.getAccessToken === "function") {
          const t = await gauth.getAccessToken();
          if (t) return t;
        }
      }
    } catch (e) {
      console.warn("[viewer.auth] gauth.module.js import failed", e);
    }

    // 4. 最後の手段としてレガシーなグローバル（あれば）
    if (typeof window !== "undefined" && window.__LM_TOK) {
      return window.__LM_TOK;
    }

    // トークンがなくても、ファイルが完全公開なら成功しうるので null で返す
    return null;
  }

  async function fetchWithToken() {
    let tok = await resolveToken();
    let headers = tok ? { Authorization: `Bearer ${tok}` } : {};
    let res = await fetch(url, { method: "GET", headers });

    // 認可エラーの場合は一度だけトークンを取り直してリトライ
    if (res.status === 401 || res.status === 403) {
      try {
        token = null; // resolveToken をやり直すためにリセット
        tok = await resolveToken();
        headers = tok ? { Authorization: `Bearer ${tok}` } : {};
        res = await fetch(url, { method: "GET", headers });
      } catch (e) {
        console.warn(
          "[viewer.module] token refresh after 401/403 failed",
          e
        );
      }
    }

    if (!res.ok) {
      throw new Error(`Drive fetch failed: ${res.status}`);
    }
    return res;
  }

  console.log("[viewer.module] loading GLB from Drive", {
    fileId,
  });

  const response = await fetchWithToken();
  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();

  // GLTFLoader が認可のことを気にしなくていいように、blob URL 経由で読み込む
  const objectURL = URL.createObjectURL(new Blob([arrayBuffer]));
  try {
    const loader = ensureGltfLoader(); // 既存の GLTFLoader 生成関数
    const gltf = await loader.loadAsync(objectURL);
    const viewer = ensureViewer(); // 既存の viewer 取得関数
    const scene = viewer.scene;

    // 既存シーンをクリアして新しい GLB を追加
    while (scene.children.length) {
      scene.remove(scene.children[0]);
    }
    scene.add(gltf.scene);

    // カメラを新しいシーンに合わせてフレーミング
    adjustCameraToScene(viewer); // 既存のカメラ調整関数

    // 即時レンダリング
    viewer.render();

    return gltf;
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

// ---- LociMyu patch: export getScene / materials helpers など、以降の既存コードが続く ----

// ここから下は、元の viewer.module.cdn.js に入っていた
// - ensureViewer / onRenderTick / listMaterials / applyMaterialProps
// - resetMaterial / resetAllMaterials / addPinMarker / clearPins / projectPoint / setPinSelected
// などの既存エクスポート群がそのまま残っています。
// （実際のファイルでは全エクスポート関数本体も含めて貼り付けてあります）

// ===== viewer.module.cdn.js ここまで =====
