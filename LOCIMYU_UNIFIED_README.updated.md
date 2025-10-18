# キャプションタブ — Fix仕様（2025-10-19）

> 本節は「キャプション」タブに関する **現行実装**を仕様として確定したものです。UI→処理→Google Sheets 同期の結合点を明確化し、現場での再実装やテスト時の照合表として使えます。

---

## 1. UI コンポーネントと責務

### 1.1 シート選択（プルダウン）
- DOM: `#save-target-sheet`（フォールバック: `#sheet-select`。キャプションペイン内 `<select>` を自動検出） fileciteturn10file7
- 表示: 現在の保存先シート（ワークシート）を選択。
- データ: `<option>` は `value=sheetId`、`textContent=シート名`、**`dataset.title=シート名`**（A1表記生成のため UI とデータを同期）。
- 挙動: 選択変更で `window.currentSheetId` / `window.currentSheetTitle` を更新し、ホバー用 `select.title` に反映。 fileciteturn10file4

### 1.2 シート名変更 UI（インライン）
- DOM: `#sheet-rename`（✎ / ラベル / 入力 / ✓ / ×）を**シート選択の直下**に自動マウント。 fileciteturn10file4
- 操作: ✎/ラベルクリック/ダブルクリックで編集モード、Enter/✓ で確定、Esc/× でキャンセル。 fileciteturn10file4
- 成功時: `spreadsheets.batchUpdate(updateSheetProperties)` でタイトル更新 →  
  `window.currentSheetTitle`、`option.textContent`、**`option.dataset.title`** を**同時に更新** → `ensureIndex()` を即時実行して反映。 fileciteturn10file4turn10file8
- 失敗時: ラベル/`option.textContent`/`option.dataset.title`/`window.currentSheetTitle` を**完全ロールバック**。 fileciteturn10file4

### 1.3 キャプション一覧（Caption list）
- DOM: `#caption-list`（リスト本体）。各項目は `.caption-item[data-id="<pinId>"]`。 fileciteturn10file8
- サムネイル: `.cap-thumb` を想定（**画像がない場合は文字を出さず、控えめな色面のみ**のプレースホルダー）。スタイルは 36×36 の角丸正方形。 fileciteturn10file9
- タイトル/本文表示: `.cap-title` / `.cap-body`（本文はヒント調で抑制）。 fileciteturn10file8
- 選択: クリックで対象ピンを選択・フォームへ反映・オーバーレイ生成。 fileciteturn10file8
- 削除: 各行の「×」ボタン → ピン削除、オーバーレイ破棄、**Sheets 行削除**（`deleteDimension`）→ UI/キャッシュ更新。 fileciteturn10file8

### 1.4 タイトル／本文フォーム
- DOM: `#caption-title` / `#caption-body`（単行入力）。選択ピンの内容を双方向に反映。 fileciteturn10file7
- 保存: オートセーブ＋確定アクションで `values.update` または状況により `values.append` を実行。 fileciteturn10file8

### 1.5 画像プレビュー／添付
- DOM: `#currentImageThumb`（56×56、角丸、**画像なしは簡素なプレースホルダー**）。 fileciteturn10file9
- 反映: 画像添付/解除に応じてプレビュー切替。GLB 連動の右ペインと重複しないよう最小表示。 fileciteturn10file8

### 1.6 ピンカラー／フィルター
- DOM: カラーチップ（`.chip-color`）／フィルタ（`.chip-filter`）。選択状態はクラスで視覚反映し、一覧の可視性を切替。 fileciteturn10file9

### 1.7 ドロップダウンの幅固定
- シート名が長くても**UI 幅は固定**（240px）。プルダウン展開時のみ全名表示（`title` 併用）。 fileciteturn10file6

---

## 2. 認証・トークン管理（GIS）
- 実装: `gauth.module.js`。`setupAuth()` がボタンにイベントを配線し、**サイレント取得→必要時のみ対話**の順でトークン取得。`getAccessToken()` を全モジュールで共有。 fileciteturn10file5
- スコープ: `spreadsheets` / `drive.file` / `drive.readonly` 他。`locimyu.config.js` または `<meta>` から `client_id`/API Key/Scopes を受け取れる。 fileciteturn10file2turn10file7
- UI反映: サインイン後、GLB ロード／画像リフレッシュ／シート操作のボタンが有効化。 fileciteturn10file8

---

## 3. Sheets I/O 仕様（読み・書き・削除）

### 3.1 A1 範囲の基準
- 基本範囲は `A1:Z9999`。シート参照は **現在名**（`currentSheetTitle`）で `'${currentSheetTitle}'!A1:Z9999` を生成。リネーム後は `option.dataset.title` と `window.currentSheetTitle` を**一致**させる。 fileciteturn10file8

### 3.2 インデックス（ensureIndex）
- 役割: `id` → `rowIndex`（1-based）を `captionsIndex` に再構成。ヘッダ行は 1 行目。 fileciteturn10file8
- 呼び出し契機: シート切替／リネーム成功直後／保存後の整合性回復。 fileciteturn10file4turn10file8

### 3.3 新規／更新／削除
- 新規行: 既存空行が無い場合は `values.append`。空行再利用の判定は内部ロジックで実施（必要時のみ append）。 fileciteturn10file8
- 更新: 既存行は `values.update`（行インデックスで特定）。 fileciteturn10file8
- 削除: **行削除**は `deleteDimension`（UI の「×」）。**論理削除**（セル空白化）を採る場面（自動保存の取消相当）が必要なときは値上書きのみで行番号を崩さない。 fileciteturn10file8

> 備考: リネーム後に **旧名の A1** でアクセスすると 400（Bad Request）。本実装は `dataset.title` と `currentSheetTitle` を同時更新し、`ensureIndex()` を直後に呼ぶため、再発しない。 fileciteturn10file4turn10file8

---

## 4. ピン／オーバーレイ連動

### 4.1 選択・反映
- ピン選択でフォーム（タイトル/本文）・一覧選択状態・オーバーレイを同期。`setPinSelected()` で 3D マーカーも視覚反映。 fileciteturn10file3turn10file8

### 4.2 キャプションオーバーレイ
- 画面固定のカード＋**GLB上のピン位置と線分で結線**。ズーム（±）とドラッグ移動、×で閉じる。描画は毎フレーム `projectPoint()` で追従。画像は Drive の blob/thumbnail API から動的読込。 fileciteturn10file8

---

## 5. ドロップダウン幅・レイアウト安定化
- プルダウン本体は 240px 幅に**固定**（文字量に依存せず UI 崩れを防止）。選択肢の全名は展開または `title` 属性で確認可能。 fileciteturn10file6

---

## 6. 認証・GLB ロードとの関係
- GLB ロード（Drive / URL）はサインイン後のみ有効。トークンは `getAccessToken()` を介して供給。未サインイン時は UI が無効化され、起動時のログで警告。 fileciteturn10file0turn10file8

---

## 7. 競合と同時編集
- 同一シートを **複数人**で編集しても、**同じ pinId の同時更新**でない限り衝突しにくい（行番号の移動削除を極力避け、`id` で行を直接参照するため）。最後に保存した側が勝つ（lightweight ルール）。 fileciteturn10file8

---

## 8. 既知の注意点／将来拡張
- Three.js 多重 import の警告は現状影響軽微。将来バンドル段階で一本化。 fileciteturn10file3
- 画像なしプレースホルダーは**色面のみ**（テキストやアイコンは出さない）。一覧の視認性・軽快さを優先。 fileciteturn10file9
- 大量追加/削除を長期継続するケースではシートにスパースが生じうるため、定期的な空行圧縮ユーティリティの提供を検討。 fileciteturn10file8

---

## 付録 A. 関連ファイルと該当箇所
- `index.html`: UI骨子（GLB入力、シート選択、キャプションペイン各領域）。 fileciteturn10file7
- `app.sheet-rename.css`: シート選択 UI の幅固定。 fileciteturn10file6
- `gauth.module.js`: GIS 認証（サイレント→必要時対話、トークン共有 API）。 fileciteturn10file5
- `sheet-rename.module.js`: リネーム UI、`dataset.title` 同期、`ensureIndex()` 呼び出し、IDスニッファ。 fileciteturn10file4
- `boot.esm.cdn.js`: キャプション I/O、インデックス、一覧・オーバーレイ、画像プレビュー、削除の batchUpdate（deleteDimension）。 fileciteturn10file8
- `viewer.module.cdn.js`: 3D ビューア、ピック、ピン描画/選択。 fileciteturn10file3
- `boot.esm.js`（ESM最小ブート）: 代替ブート構成（小規模導入向け）。 fileciteturn10file0

---

# 🚧 マテリアルタブ — 改修計画（**改修中ドラフト**）
*最終更新: 2025-10-19 03:43 (UTC+09:00)*

> 本節は **進行中（WIP）** の仕様です。現行のキャプションタブ Fix 仕様とは独立して管理し、安定後に「確定仕様」章として昇格します。

## 0. 目的とスコープ
- 読み込んだ **GLB 内の各マテリアル**の描画設定（描画方式・透明度・白/黒→透過）を **キャプション“シート単位”で保存・自動適用**する。
- キャプションタブと **UI/UX の思想・操作感を共通化**し、迷いなく操作できることを重視。

## 1. 編集項目（初期リリース）
1) **描画方式**: `standard` ⇄ `unlit`  
   - *unlit*: 影やライティングの寄与を無効化し、アルベド（ベースカラー/テクスチャ）に忠実なフラット描画。  
2) **透明度**: `opacity` スライダー（0.00–1.00、0.01刻み）  
   - `transparent` の有効化、`depthWrite/alphaTest` は内部最適化。  
3) **白/黒の透明化**（テクスチャ/ベースカラーに対する輝度判定）  
   - **白→透過**: `whiteToTransparent`（bool）+ `whiteThreshold`（0.80–1.00）  
   - **黒→透過**: `blackToTransparent`（bool）+ `blackThreshold`（0.00–0.20）  
   - 実装: `onBeforeCompile` によるシェーダ拡張（uniform 更新のみでリアルタイム反映）。

## 2. 保存/自動適用（Sheets 設計）
- 保存先: **キャプションと同じスプレッドシート**内の `Materials` シート（新設）。
- **シート紐づけキー**: `captionGid`（= キャプションシートの gid 固有値。名称変更に強い）
- **GLB 識別子**: `glbId`（= fileId 等、既存の GLB ID を流用）
- **マテリアル識別子**: `materialKey = "<glbId>::<matIndex>::<matName?>"`
- **主キー相当**: `captionGid + glbId + materialKey`

### 2.1 Materials シート列設計（v1）
| 列 | 名称 | 型 | 説明 |
|---|---|---|---|
| A | captionGid | number | キャプションシート gid |
| B | glbId | string | GLB 識別子（fileId 等） |
| C | materialKey | string | `<glbId>::<index>::<name?>` |
| D | mode | enum | `standard` / `unlit` |
| E | opacity | number | 0–1 |
| F | whiteToTransparent | bool | true/false |
| G | whiteThreshold | number | 0–1 |
| H | blackToTransparent | bool | true/false |
| I | blackThreshold | number | 0–1 |
| J | doubleSided | bool | 将来拡張用 |
| K | updatedAt | ISO | 更新時刻 |
| L | by | string | 実行ユーザ（メール） |
| M | version | number | スキーマ版（初期 1） |

- **行削除はしない**（空白上書き & 空行再利用）。更新は `upsert(materialKey)` 方針。  
- **複数候補**がある場合は `updatedAt` が **最新**を採用（最後に保存した人が勝つ）。

### 2.2 ランタイム適用フロー
1) キャプションシート決定（`ensureIndex()` 完了）→ `window.captionGid` 更新  
2) GLB 読込完了 → `Materials` を読み、**`captionGid` と `glbId` が一致**する行のみ抽出  
3) `materialKey` 合致ごとに Three 側へ適用（uniform 更新/パラメータ反映）  
4) UI 操作 → **即時プレビュー**（楽観）→ `ensureToken` → `upsert` → 失敗時ロールバック

## 3. UI/UX（キャプション準拠）
- 右ペインの「Material」タブ内に **マテリアルカードのリスト**を表示。
- カード要素: `material.name` / 描画方式トグル / 透明度スライダー / 白→透過（閾値） / 黒→透過（閾値） / Reset。
- 上部: **検索**（name フィルタ）、**表示切替**（全/使用中/選択ピン関連）。
- **操作は即反映**（0.2s デバウンスで保存）。スライダーは数値入力併設。

## 4. Three.js 実装メモ
- **Unlit**: `onBeforeCompile` でライティング関連チャンクを no-op 化。  
- **透明度**: `opacity`/`transparent`、必要に応じ `alphaTest≈0.003–0.01`、極端な 0.0 では `depthWrite=false`。  
- **白/黒→透過**: `uniform`（`uWhiteThr/uBlackThr`、`uWhiteToAlpha/uBlackToAlpha`）で判定し `alpha=0`/`discard`。  
- **Reset**: 初回適用時のスナップショットを `WeakMap<Mesh, Snapshot>` に保持して復元。

## 5. API（viewer.module 予定公開）
- `listMaterials() -> Array<{index, name, materialKey}>`  
- `applyMaterialProps(materialKey, props)` / `resetMaterial(materialKey)`  
- ショートカット: `setUnlit(key, on)`, `setOpacity(key, v)`, `setWhiteToTransparent(key, on, thr)`, `setBlackToTransparent(key, on, thr)`

## 6. 競合・複製・移行
- **同時編集**: 最終更新勝ち（行削除なし）。  
- **キャプションシート複製**: gid が変わるため `Materials` はヒットしない。UI に **「別シートから設定をコピー」**（旧 gid → 新 gid）を提供。  
- **旧データ移行**: タイトル紐づけしか無い場合は一度 gid 採番（title↔gid 表で移行）。

## 7. 開発順序（PR 粒度）
1) `viewer.module.cdn.js`: hook/uniform/適用・復元の最小実装（Unlit/Opacity）  
2) UI 骨組み（リスト & コントロール）＋ **白→透過** 実装  
3) `Materials` I/O（`captionGid + glbId + materialKey` で upsert & 自動適用）  
4) Reset（個別/全体）、Undo（直前のみ：任意）  
5) README 本章の「改修中」→「確定仕様」への昇格

---

> **整合性の原則**  
> - UIの操作感はキャプションタブを踏襲し「削らない」。  
> - モジュール間の状態は `window` ブリッジで共有。  
> - 書き込みは「トークン確認→API→楽観更新→失敗時ロールバック」。
