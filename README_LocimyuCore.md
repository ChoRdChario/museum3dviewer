# Locimyu Core (UI-free) — ハンドオフ資料

このモジュールは **UI を持たないコア層** です。Google Drive/Sheets からの **GLB 読み込み**、
**ピンシートの自動解決**、**ピンの取得**、**マテリアル状態の抽出**を担当し、
UI は **EventTarget ベースのイベント**で呼び出し・受け取りを行います。

## 目的

- 既存UIと切り離し、**あらゆるUI（PC/モバイル/ボトムシート/紙面風 etc.）を差し替え可能**に。
- 既存の **Drive 直接 `alt=media`**、**Sheets 読み取り**、**同フォルダ探索**の動線は維持。
- UI 層からは「GLB の URL 受領 → three.js 側で読み込む」「ピン配列を受領 → 描画」だけを行う。

---

## 提供物

- `locimyu-core.js`（ES Module）
- イベントとメソッドの仕様（下記）

必要スコープ（読み取りのみ）:
- `https://www.googleapis.com/auth/drive.readonly`
- `https://www.googleapis.com/auth/drive.metadata.readonly`
- `https://www.googleapis.com/auth/spreadsheets.readonly`

> Sheets スコープが無い場合、**Drive の CSV エクスポート**でフォールバックします。

---

## API 概要

```ts
class LocimyuCore extends EventTarget {
  constructor(opts?: { gapi?: any; fetchImpl?: typeof fetch });
  extractDriveFileId(input: string): string | null;
  initGapi(cfg: { apiKey:string; clientId:string; scopes:string[]; discoveryDocs?:string[] }): Promise<void>;

  loadGLB(inputOrId: string): Promise<void>;     // URL でも ID でも可
  loadGLBByFileId(fileId: string): Promise<void>;

  resolvePinSpreadsheet(fileId?: string): Promise<{sheetId:string, name:string} | null>;
  loadPins(sheetId?: string): Promise<Pin[]>;

  rowsToMaterialState(rows: string[][]): Record<string, any>;

  revokeObjectURL(): void;
  get glbFileId(): string | null;
  get sheetId(): string | null;
  get sheetTitle(): string | null;
}
type Pin = { id: any; title: string; body: string; img: string; _row: number };
```

### 発火イベント

| イベント名         | detail の形                                  | 目的 |
|-------------------|----------------------------------------------|------|
| `auth:ready`      | —                                            | gapi 初期化完了通知 |
| `glb:meta`        | `{ fileId, parents: string[], name?:string }`| GLB のメタ（親フォルダ解決用） |
| `glb:url`         | `{ fileId, objectUrl }`                      | **three.js へ渡す Blob URL** |
| `sheet:resolved`  | `{ sheetId, name }`                          | ピンシート解決 |
| `pins:loaded`     | `{ pins: Pin[], sheetId }`                   | ピン一覧 |
| `error`           | `Error`                                      | 非致命/致命エラー通知 |

> three.js ロード完了（`modelLoaded`）は **UI 側**で管理し、必要ならアプリ固有のイベントに変換してください。

---

## 最小統合例（UI 側）

```html
<script src="https://apis.google.com/js/api.js"></script>
<script type="module">
  import { LocimyuCore } from './locimyu-core.js';

  const core = new LocimyuCore({ gapi });

  core.addEventListener('glb:url', (e) => {
    const { objectUrl } = e.detail;
    // three.js GLTFLoader で読み込む
    loader.load(objectUrl, (gltf) => {
      // ... set scene, camera, etc.
      // UI 都合の modelLoaded イベントを出すならここ
    });
  });

  core.addEventListener('sheet:resolved', async (e) => {
    await core.loadPins(e.detail.sheetId);
  });

  core.addEventListener('pins:loaded', (e) => {
    renderPinList(e.detail.pins); // UI による描画
  });

  core.addEventListener('error', (e) => {
    console.error('[LocimyuCore]', e.detail);
    // UI によるトースト表示など
  });

  // 1) gapi 初期化（必要なら）
  // await core.initGapi({ apiKey, clientId, scopes: [...], discoveryDocs: [...] });

  // 2) GLB 指定（URL or FileId）
  await core.loadGLB('https://drive.google.com/file/d/FILE_ID/view?usp=sharing');

  // 3) ピンシート解決 → ピン読込
  await core.resolvePinSpreadsheet();
  // → pins:loaded イベントで UI 側に配列が届きます
</script>
```

---

## 実装の注意（互換と堅牢性）

- **OAuth は gapi.client.getToken() で取得**し、fetch の `Authorization: Bearer` に渡して `alt=media` 取得。
- Drive 検索 `q` は **`and`** を使い、`&&` は使わない（400 回避）。
- Sheets API で失敗したときは **Drive CSV エクスポート**へ自動フォールバック。
- **UI へ副作用を持たない**（DOM 遮断）。three.js への適用は UI 側の責務。
- Safari/古環境対策で **optional chaining を使わない**。

---

## マテリアル適用について

コアは `rowsToMaterialState(rows)` だけを提供します。three.js 側の適用例：

```js
function applyMaterialState(root, state){
  root.traverse((obj) => {
    if (!obj.isMesh || !obj.material) return;
    const m = obj.material;
    const name = m.name || obj.name; // 運用に合わせてキーを決める
    const st = state[name];
    if (!st) return;
    if (typeof st.opacity === 'number'){ m.opacity = st.opacity; m.transparent = st.opacity < 1; }
    if (typeof st.metalness === 'number'){ m.metalness = st.metalness; }
    if (typeof st.roughness === 'number'){ m.roughness = st.roughness; }
    if (st.color){ try{ m.color.set(st.color); }catch(_){ } }
    m.needsUpdate = true;
  });
}
```

---

## 既存コードとのブリッジ（段階移行）

- 旧UIが `M3DUI.modelLoaded()` を呼ぶ場所で、UI 側から `core.resolvePinSpreadsheet()` → `core.loadPins()` を起動してください。
- 旧 `selectPin(id)` は UI 内部の話なので、コアは関知しません（pins 配列から該当オブジェクトを探して UI で描画）。

---

## 既知の制約

- サインイン・トークン更新などの UX は **UI 側**で制御してください（本コアは最小実装）。
- スコープ不足時は CSV フォールバックで読む想定ですが、**組織ポリシーによりエクスポート禁止**の場合は Sheets スコープが必須です。

---

## 連絡事項（運用メモ）

- GLB は **共有URLのコピペ**が最強。ID 直貼りは 30 文字以上（欠けていると 404）。
- ピンシートは **GLB の親フォルダ**に置く運用（`lociFor` appProperties が付いていると最優先）。
- UI の最適化は自由に（本コアはイベントで結果を返すだけ）。
