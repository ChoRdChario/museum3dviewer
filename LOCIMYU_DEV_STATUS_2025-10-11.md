# LociMyu 開発ノート（2025-10-11 現状/方針）

このドキュメントは、**現状のファイル整理・機能整理・開発方針**をまとめたものです。  
当面は _Caption タブ_ を完成させ、続いて _View タブ_、_Material タブ_ の配線へ移行します。

---

## 1) 現状サマリー（記憶ベース + 直近の実装）

- **認証**：`gauth.module.js`（Google Identity Services; GIS）を採用。  
  - `window.GIS_CLIENT_ID / GIS_API_KEY / GIS_SCOPES` を **`locimyu.config.js`** で事前定義、もしくは `boot.esm.cdn.js` から **明示的に渡す**形で両対応。
  - スコープ：`drive.readonly, drive.file, drive.metadata.readonly, spreadsheets`。403/400 回避の基本。

- **GLB ロード**（Drive 直取得）
  - `viewer.module.cdn.js` が **Three.js + GLTFLoader** を CDN から import。
  - `loadGlbFromDrive(fileId, { token })`：`GET https://www.googleapis.com/drive/v3/files/{id}?alt=media` + `Authorization: Bearer …` で **CORS 安全**に取得。
  - ロード完了後、**親フォルダ**を取得 → **同階層のスプレッドシート**（LociMyu 形式）を **探索/自動作成**。

- **Caption タブ（現行フォーカス）**
  - **シート構造**：`[id, title, body, color, x, y, z, imageFileId]` を基本列に採用（`LOCIMYU_HEADERS`）。
  - **読み込み**：該当シート（タブ）選択/新規追加 → 行データをピン＆リストに同期。
  - **追加**：Shift+クリックで3D上のヒット位置にピン作成 → 同時に行追加。
  - **編集/削除**：
    - **Caption ウィンドウ**（ドラッグ可、右上に ✎/🗑/×）：編集・削除が可能、ピンと **線で接続**。カメラ操作に追従。
    - **Caption リスト**側でも 🗑 で **行＋ピン削除** をサポート。
  - **画像**：GLB と **同階層**の `image/*` を Drive API で列挙 → **サムネグリッド**表示 → クリックで **選択中ピンへ imageFileId を保存**。HEIC/HEIF は Drive の `thumbnailLink` を使用し表示可能。

- **UI 配置（最近の調整）**
  - 「Load」ボタンを **GLB URL/ID 入力の横**へ。
  - 「Refresh images」は **キャプションリスト下**へ。
  - **ピンカラー**は 8 色に縮小、**フィルタ**はチェックボックスで **選択色のみ表示**。

- **既知の課題**
  - `client_id` 未検出 → **config の読み順** or **boot から明示渡し**で解決（両実装済み）。
  - 400/403：**スコープ不足/Consent 不一致/JS Origins** で発生。GIS 側設定を確認。
  - 一部 SyntaxError（テンプレート文字列内のバッククォート衝突）→箇所を **DOM 組立方式**に差替済み。
  - **Caption ウィンドウの初期位置・線**：追従は実装済みだが、細かい見栄え（太さ/透明度/当たり判定）を要微調整。

---

## 2) ファイル構成と役割

> **ESM/CDN 系を「正系（新系統）」として採用**。`type="module"`、三つ巴の役割分担で保守性を担保。

### 正系（採用）
- **`locimyu.config.js`**：GIS の `client_id` / `api_key` / `scopes` を `window.*` へ注入。  
  - _index.html の **最上流**で読み込む。_  
  - 代替として `boot.esm.cdn.js` 側から `setupAuth(..., { clientId, apiKey, scopes })` 明示渡しも実装済み。
- **`gauth.module.js`**：GIS（Google Identity Services）ラッパ。  
  - `setupAuth(signInButton, onSignedSwitch, opts?)` / `getAccessToken()` を公開。
- **`viewer.module.cdn.js`**：Three.js ビューア。  
  - `ensureViewer({ canvas })` / `loadGlbFromDrive(fileId, { token })` / `addPinMarker` / `removePinMarker` / `setPinSelected` / `projectPoint` / `onCanvasShiftPick`（Shift+クリック拾い）/ `onPinSelect` など。
  - **ピンの小球サイズ**はモデルの AABB から自動スケール（視認性担保）。
- **`boot.esm.cdn.js`**：アプリの配線ハブ（Drive/Sheets/Viewer/UI glue）。  
  - GLB ロード → 親フォルダ → シート探索/作成 → タブ列挙 → **Caption 読込** → **画像自動列挙**。  
  - **Caption オーバーレイ**（ドラッグ、線で接続、✎/🗑/×）・**リスト個別削除**を実装。

### 旧系（残置・参照のみ）
- `gauth.js` / `gauth.module.js`（※ `gauth.js` は **未使用**にしたい）
- `viewer.js` / `pins.js` / `material_panel.js` / `app_boot.js`  
- `utils_drive_api.js` / `utils_drive_images.js` / `sheets_api.js` などの個別 API ラッパ
  - 旧系は **重複実装**（Drive/Sheets 叩き）が散在するため、**混入禁止**。参照のみ許可。

> **運用ルール**：旧系は `legacy/` へまとめ、**import/読み込みを行わない**。  
> 依存の見落としを防ぐため、`index.html` の `<script>` 群を最小構成に固定。

---

## 3) index.html の **読み込み順序**（基準形）

```html
<!-- (1) 設定：clientId/apiKey/scopes を最初に注入 -->
<script src="./locimyu.config.js"></script>

<!-- (2) アプリ本体（ESM） -->
<script type="module" src="./gauth.module.js"></script>
<script type="module" src="./viewer.module.cdn.js"></script>
<script type="module" src="./boot.esm.cdn.js"></script>
```

> `locimyu.config.js` が無い環境でも動くよう、`boot.esm.cdn.js` から `setupAuth(..., { clientId, apiKey, scopes })` を**明示渡し**済み。

---

## 4) Caption タブ：現在の完了度と TODO

### 実装済み
- Drive ID 解析（URL/パス/ID 単体対応）
- GLB ロード（token 付 alt=media）
- 親フォルダ検出 → シート探索/自動作成（ヘッダ自動整備）
- シートタブ列挙・選択/新規作成
- 行→ピン/リスト同期、Shift+クリックでピン追加
- 画像グリッド（同階層 image/* を列挙、HEIC/HEIF サムネOK）
- **Caption オーバーレイ（ドラッグ可、線で接続、✎/🗑/×）**
- **Caption リスト個別削除（🗑）**
- ピンカラー 8 色、色フィルタ

### 未了/調整
- オーバーレイの**視覚調整**（線の太さ/色、ウィンドウの余白/影）
- **初期位置**の賢い配置（画面外回避、ズーム時の相対オフセット）
- 画像選択時の**UI 状態**（ピン選択が外れないように、リストスクロール保持）
- **エラーハンドリング**（Drive/Sheets API エラーメッセージのユーザー表示を統一）
- **SyntaxError の再発防止**（テンプレートリテラル混入禁止、DOM ビルダー徹底）

---

## 5) View タブ：予定する配線（次フェーズ）

- **カメラ系**：OrbitControls のパラメータ UI 化（感度、ダンピング、ズーム制限）
- **投影切替**：Perspective / Orthographic の切替（`viewer.module.cdn.js` に API 追加）
- **スナップ**：プリセット視点（前/右/上/等角）ボタンと `controls.target` セット
- **グリッド/軸表示**：ON/OFF 切替（補助線の表示/非表示）
- **FOV/近遠クリップ**：数値スライダ → `camera.updateProjectionMatrix()`

> **保存対象外**（UI 状態。Caption シートには書かない）

---

## 6) Material タブ：予定する配線（次フェーズ）

- **選択メッシュの色/粗さ/金属度**の微調整（StandardMaterial を前提）
- **環境光の強度**、**方向光の強度/方向**のスライダ（viewer 側でライト参照を公開）
- **ワイヤーフレーム**切替、**透明度**スライダ
- 将来：**マテリアルプリセット**の保存（別シート or JSON；まずは保存なしで UI のみ）

---

## 7) 重複/混在の検出とガイドライン

- **重複が疑われる領域**
  - *Drive/Sheets ラッパ*：`boot.esm.cdn.js` に必要関数が揃っているため、旧 `utils_*` は読み込まない。
  - *ビューア*：`viewer.module.cdn.js` を唯一の入口に。旧 `viewer.js`/`pins.js` は参照のみ。
  - *認証*：`gauth.module.js` に一本化。`gauth.js` は使わない。

- **ガイドライン**
  1. `index.html` の `<script>` は **config + 3本（gauth/viewer/boot）だけ**。
  2. 旧系は `legacy/` に隔離。**import も `<script>` も禁止**。
  3. 新規機能は **viewer = 3D、boot = アプリ配線** に厳密分離。Drive/Sheets は boot 側。

---

## 8) 環境要件（GIS）

- **OAuth consent**：テストユーザー登録、スコープ承認（Drive/Sheets）。
- **Authorized JavaScript origins**：公開 URL（例: `https://*.github.io`）。
- **ポップアップブロック**：ブラウザで無効化。
- **400/403** が出るときは：
  1. `client_id` 検出（コンソールに Missing client_id が無いか）
  2. スコープ/JS オリジン設定
  3. `drive.file` の含有（作成/更新系は必須）

---

## 9) 次ステップ（Caption 完了→View/Material 着手まで）

- [ ] Caption：オーバーレイの見栄えと初期位置調整（係数/余白/線色）
- [ ] Caption：画像選択時の UI 状態維持（選択ピン/スクロール）
- [ ] Caption：API エラー表示の統一（トースト/ラベル）
- [ ] View：投影切替 API を `viewer.module.cdn.js` に実装（Perspective/Ortho）
- [ ] View：プリセット視点（前/右/上/等角）ボタン
- [ ] Material：ライト/マテリアル調整用 API を viewer へ追加 → UI を boot 側で配線

---

## 10) 受け入れ基準（Caption タブ）

- [ ] Shift+クリックでピン生成 → **即オーバーレイ表示**＆線が追従
- [ ] リスト項目クリックで **オーバーレイ表示**＆該当ピンが選択状態
- [ ] リスト/オーバーレイの **🗑** で **Sheets 行＋ピン＋UI 要素**が一括削除
- [ ] 画像選択で **imageFileId 更新**、リスト＆オーバーレイの画像が即時反映
- [ ] GLB ロード時に **同階層シートの発見/作成**・タブ選択・画像自動列挙が完走
- [ ] ハードリロード後も **読み込み順**で `Missing client_id` が出ない

---

## 付録：主要公開 API（抜粋）

- **gauth.module.js**
  - `setupAuth(signInBtn, onSignedSwitch, opts?)`
  - `getAccessToken()`

- **viewer.module.cdn.js**
  - `ensureViewer({ canvas })`
  - `loadGlbFromDrive(fileId, { token })`
  - `addPinMarker({ id,x,y,z,color }) / removePinMarker(id) / clearPins()`
  - `setPinSelected(id, on)`
  - `projectPoint(x,y,z)` → `{ x,y,visible }`
  - `onCanvasShiftPick(fn)` / `onPinSelect(fn)`
  - （今後）`setProjection(mode)` / `presetView(name)` / `setLightParams(...)` など

---

以上。Caption を仕上げたら View → Material の順に移行します。
