# LociMyu 3D Caption Tool — 統合ドキュメント

本書は、安定版（`index.zip`）に含まれる全ファイルを通読したうえで、アプリの**目的/機能/構成/データ連携/今後の開発計画/技術的申し送り**を一つに統合したドキュメントです。

## 1. 目的（What / Why）
- 3Dモデル（GLB）上に**ピン**を打ち、学芸員向けの**キャプション（タイトル・本文・色・座標・画像添付）**を作成・編集・閲覧できるツール。
- キャプションは Google Sheets を**台帳（単一の Captions シート）**として保存・同期し、画像は Google Drive の**GLB ファイルの親フォルダ**配下を参照して添付管理する。
- ビューアは Three.js ベース。UIは**キャプションリスト**・**オーバーレイ**・**画像グリッド**・**フォーム入力**で構成。

## 2. 機能一覧（現状）
- **GLBロード**：ローカル/URL/Drive(fileId+token)の複数経路。
- **ピン管理**：追加・選択・削除、座標追従。
- **キャプション管理**：タイトル/本文/色/画像の入力、リスト表示、オーバーレイ表示。
- **画像管理**：Drive からのサムネ・原画像取得、添付/デタッチ。
- **永続化**：Google Sheets の `Captions` シートに保存（id/title/body/color/x/y/z/imageFileId/createdAt/updatedAt）。
- **開発向けログ**：起動/GLB/Sheets 連携等のコンソールログ。

## 3. ファイル構成（安定版 `index.zip`）

```text
- ARCHITECTURE_README.md
- DEV_NOTES.md
- LOCIMYU_DEV_STATUS_2025-10-11.md
- PATCH_NOTES.md
- README_PATCH.md
- app.css
- boot.esm.cdn.js
- boot.esm.js
- favicon.ico
- gauth.module.js
- index.html
- leader.css
- locimyu.config.js
- viewer.module.cdn.js
```

## 4. コード要点（ざっくり把握）
- `index.html`：エントリ。Three.js/viewer/本体スクリプト読込、UIプレースホルダ。
- `boot.esm.cdn.js`：アプリ本体。GLB読み込み、UI配線、Drive/Sheets連携、キャプション/画像周りのロジックが集約。
- `viewer.module.cdn.js`：Three.jsベースのビューア制御（軌道操作、ピン描画、クリックヒットテスト等）。
- `gauth.module.js`：Google 認証/トークン取得補助。
- `app.css`/`leader.css`：UI/レイアウトスタイル。
- `locimyu.config.js`：アプリ構成値（APIスコープ・フラグ等）。

## 5. データモデル（Captions シート）
- **列**: `id`, `title`, `body`, `color`, `x`, `y`, `z`, `imageFileId`, `createdAt`, `updatedAt`
- **id** はピン（あるいは行）の一意キー。`x,y,z` は GLB 空間座標。
- **imageFileId** は Google Drive ファイルID。

## 6. 外部連携（Google Drive / Sheets）
- 認証: OAuth（`gauth.module.js`）→ `getAccessToken()` を通じて各 API 呼び出しに Bearer を付与。
- Drive: 親フォルダ（GLBの親）での画像列挙、サムネURLの取得、ファイル本体の取得。
- Sheets: 台帳スプレッドシートの検索/作成、`Captions` シートの存在保証、行の読込/更新/削除。

## 7. 現状の安定動作と既知の注意点
- Three.js の**重複インポート**警告は動作に致命ではないが、将来的に import ルートを一本化すると静かになる。
- キャッシュの影響を受けやすい（GitHub Pages/CDN）。**クエリバージョン**や**ハッシュ付きファイル名**で回避推奨。
- ビルド済みJSの直接編集は構文崩れの温床。**元ソース→ビルド**のフローを基本とする。

## 8. 今後の開発ロードマップ（優先度順）
1. **キャプションリストの選択強調**：`.is-selected` クラスの統一、`__lm_selectPin`/リストクリック双方で同期。
2. **オーバーレイの × で閉じる**：既存UX維持、`removeCaptionOverlay(id)` の安全化（nullチェック/イベント解放）。
3. **画像添付/デタッチUI**：右ペインにアタッチ/デタッチボタン、`updateImageForPin(id)` を await 化して `[object Promise]` 問題を解消。
4. **削除の永続化**：シートの行削除と tombstone 対応（復帰防止）。
5. **GLB ロードの柔軟化**：ローカル/URL/Driveの並列対応＋UI。失敗時は非同期トースト通知。
6. **import 一本化**：Three.js/viewer の読み口を単一にして重複警告を解消。

## 9. 技術的申し送り（実装ガイド）
- **イベント配線**：`addEventListener(..., {capture:true})` が混在。意図がない限り同一階層では capture は避ける。
- **非同期の徹底**：Drive/Sheets/サムネURLは必ず `await`。UI更新は**成功/失敗で分岐**して明示。
- **DOM参照の一元化**：`$('id')` 等のヘルパで null ガード。描画済み要素の class 切替のみで再生成を減らす。
- **データキャッシュ**：`rowCache`/`captionsIndex` を唯一の真実源（SSOT）に。UI→キャッシュ→シートの順で同期。
- **エラー処理**：`console.warn('[LM]', context, err)` で粒度を揃える。`alert` は最小限。
- **構文崩れ防止**：bundle 直編集禁止、どうしても必要な場合は **関数単位で丸ごと置換**（前後の波括弧/テンプレの整合を確認）。
- **キャッシュ制御**：`?v=YYYYMMDDhhmm` の付与、もしくはファイル名にハッシュを付ける。

## 10. 既知の課題（要フォロー）
- Three.js 多重読込の警告
- 一部 API 呼び出しのエラー時リトライ（特に `getFileThumbUrl`）
- シート行の削除と復活防止（tombstone）
- 画像の CORS（外部URL直読み時）
- OAuth トークンの期限切れ時の UI フロー

## 付録：ソース概要スキャン結果
- 見出し検知:
  - ARCHITECTURE_README.md: # LociMyu Web Tool — Code Map & Wiring Guide
  - ARCHITECTURE_README.md: ## High-level flow (target)
  - ARCHITECTURE_README.md: ## File-by-file
  - ARCHITECTURE_README.md: ### `index.html`
  - ARCHITECTURE_README.md: ### `app.css` / `leader.css`
  - ARCHITECTURE_README.md: ### `app_boot.js`
  - ARCHITECTURE_README.md: ### `gauth.module.js`
  - ARCHITECTURE_README.md: ### `gauth.js`
  - ARCHITECTURE_README.md: ### `utils_drive_api.js`
  - ARCHITECTURE_README.md: ### `utils_drive_images.js`
  - ARCHITECTURE_README.md: ### `viewer.js`
  - ARCHITECTURE_README.md: ### `viewer_addons.js`
  - ARCHITECTURE_README.md: ### `pins.js`
  - ARCHITECTURE_README.md: ### `ui.js`
  - ARCHITECTURE_README.md: ### `material.js` / `material_panel.js`
  - ARCHITECTURE_README.md: ### `sheets_api.js`
  - ARCHITECTURE_README.md: ## Wiring diagram (current)
  - ARCHITECTURE_README.md: ## What must exist in the DOM (checklist)
  - ARCHITECTURE_README.md: ## Where real logic will plug in
  - ARCHITECTURE_README.md: ### 1) Google Auth
  - ARCHITECTURE_README.md: ### 2) Drive ID resolution & GLB loading
  - ARCHITECTURE_README.md: ### 3) Caption persistence
  - ARCHITECTURE_README.md: ### 4) Image thumbnails colocated with GLB
  - ARCHITECTURE_README.md: ### 5) Filters & colors
  - ARCHITECTURE_README.md: ## Test plan order (what you asked for)
  - ARCHITECTURE_README.md: ## Known gaps & TODOs (from current code)
  - ARCHITECTURE_README.md: ## Quick “contract” of main modules (for future wiring)
  - DEV_NOTES.md: # LociMyu 開発系統について
  - DEV_NOTES.md: ## 新系統（本番想定）
  - DEV_NOTES.md: ## 旧系統（開発・検証用）
  - DEV_NOTES.md: ## 注意点
  - LOCIMYU_DEV_STATUS_2025-10-11.md: # LociMyu 開発ノート（2025-10-11 現状/方針）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 1) 現状サマリー（記憶ベース + 直近の実装）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 2) ファイル構成と役割
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ### 正系（採用）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ### 旧系（残置・参照のみ）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 3) index.html の **読み込み順序**（基準形）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 4) Caption タブ：現在の完了度と TODO
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ### 実装済み
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ### 未了/調整
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 5) View タブ：予定する配線（次フェーズ）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 6) Material タブ：予定する配線（次フェーズ）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 7) 重複/混在の検出とガイドライン
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 8) 環境要件（GIS）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 9) 次ステップ（Caption 完了→View/Material 着手まで）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 10) 受け入れ基準（Caption タブ）
  - LOCIMYU_DEV_STATUS_2025-10-11.md: ## 付録：主要公開 API（抜粋）
  - PATCH_NOTES.md: # PATCH_NOTES (embedded complete index.html)
  - PATCH_NOTES.md: ## What’s inside
  - PATCH_NOTES.md: ## How to use
  - PATCH_NOTES.md: ## Rollback
  - PATCH_NOTES.md: ## Why this is safe
  - README_PATCH.md: # LociMyu ESM-Lite Patch
  - README_PATCH.md: ## Files
  - README_PATCH.md: ## Vendor dependencies (place in repo)
  - README_PATCH.md: ## What to remove from HTML
  - README_PATCH.md: ## Notes

- 機能検出（ヒューリスティック）:
  - boot.esm.cdn.js: GLB ロード機構あり
  - boot.esm.cdn.js: キャプション選択・リスト描画あり
  - boot.esm.cdn.js: キャプションオーバーレイUIあり
  - boot.esm.cdn.js: 画像グリッド/サムネ取得あり
  - boot.esm.js: GLB ロード機構あり
  - viewer.module.cdn.js: GLB ロード機構あり

- 技術検出（ヒューリスティック）:
  - boot.esm.cdn.js: Google Sheets/Drive API 呼び出しあり
  - boot.esm.js: three.js 使用
  - viewer.module.cdn.js: three.js 使用
  - viewer.module.cdn.js: Google Sheets/Drive API 呼び出しあり

- TODO/注意の所在（ヒューリスティック）:
  - ARCHITECTURE_README.md: found TODO/未実装/課題
  - LOCIMYU_DEV_STATUS_2025-10-11.md: found TODO/未実装/課題
  - DEV_NOTES.md: 注意/備考あり

## 11. UI コンポーネント一覧（安定板ベース）
> 画面構造と役割の「辞書」。クラス/ID は安定板の命名を前提に代表例で記載。

| 区分 | 要素/ID・クラス（例） | 役割 | 主な相互作用 |
|---|---|---|---|
| ビューア | `#viewerCanvas`（Three.js / viewer.module.cdn.js） | GLB表示、ピンの投影/ヒットテスト | ピンのクリック/ホバー、カメラ操作 |
| GLBローダ | `#glb-file`, `#btn-glb-load`（補助UIの場合） | ローカル/URL/Drive から GLB 読込 | `doLoad()` を呼び出し |
| ピン（マーカー） | `.lm-pin[data-id]` | キャプション位置の可視化・選択 | クリックで `__lm_selectPin(id)` |
| キャプションリスト | `#caption-list` 内 `.caption-item[data-id]` | 全キャプションの一覧 | クリックで選択、`.is-selected` の付け外し |
| キャプションオーバーレイ | `#caption-overlay-[id]` | 選択中キャプションのプレビュー | `×` で `removeCaptionOverlay(id)` |
| フォーム（右ペイン） | `#captionTitleInput`, `#captionBodyInput`, `#captionColor`, `#currentImageThumb` | タイトル/本文/色/添付画像の編集 | 入力変化で `updateCaptionForPin(id, patch)` |
| 画像グリッド | `#images-grid` 内 `.img-item[data-id]` | GLB親フォルダ内の画像サムネ一覧 | クリックで「添付候補」を選択 |
| 画像アタッチ/デタッチ | `#btn-attach-image`, `#btn-detach-image` | 選択画像を添付/解除 | `updateImageForPin(id)`、UI更新 |
| 削除ボタン | `.btn-delete[data-id]`（リスト/オーバーレイ） | キャプションの削除 | `deleteCaptionForPin(id)` → ピン/行/UIの掃除 |
| トースト/通知 | `.toast-area`（あれば） | 成功/失敗メッセージ | API失敗時の情報提示 |

---

## 12. イベント発火点マップ（代表）
> 実装で頻出する発火源→ハンドラ→副作用を一覧化。関数名はコード内の実名ベース。

| 発火源 | イベント | ハンドラ（関数） | 主な副作用 |
|---|---|---|---|
| GLB Load ボタン | `click` | `doLoad()` | GLB 読込 → Drive/Sheets 初期化 → `loadCaptionsFromSheet()` → UI再構築 |
| ローカルGLB input | `change` | `doLoad()`（内部で参照） | ローカルURLをObjectURL化して読込 |
| ピン（.lm-pin） | `click`（capture） | `__lm_selectPin(id)` | SSOTからレコード取得 → リスト項目を`.is-selected`に → オーバーレイ生成 → フォームへ反映（`__lm_fillFormFromCaption`） |
| キャプションリスト項目 | `click` | `__lm_selectPin(id)` | 同上（ピン→リストの逆経路） |
| タイトル/本文入力 | `input`（デバウンス） | `updateCaptionForPin(id, {title/body})` | Sheets行の更新、`rowCache`更新、オーバーレイ/リスト再描画 |
| 色選択 | `change` | `updateCaptionForPin(id, {color})` | ピン色・オーバーレイ色の変更反映 |
| 画像グリッド項目 | `click` | （無名/内包リスナ） → `selectedImage=f` | `#currentImageThumb` をサムネで更新、Attachボタン活性 |
| 画像アタッチ | `click` | `updateImageForPin(id, {imageFileId})` | Sheetsの `imageFileId` 更新、オーバーレイの画像差替え |
| 画像デタッチ | `click` | `updateImageForPin(id, {imageFileId:''})` | 同上（解除） |
| キャプション削除 | `click` | `deleteCaptionForPin(id)` | シート行削除 → `removePinMarker(id)` / `removeCaptionOverlay(id)` / キャッシュ・DOM掃除 |
| オーバーレイ × | `click` | `removeCaptionOverlay(id)` | 該当オーバーレイ要素の破棄、イベント解除 |

> SSOT（唯一の真実源）：`rowCache` / `captionsIndex`。UIは**必ずこのキャッシュを介して**同期させる。

---

## 13. Google API 権限表（最小許可）
> 認可スコープは最小権限を原則に。用途別に必要なAPIとスコープを明記。

| 用途 | API | エンドポイント例 | 必要スコープ（例） | 備考 |
|---|---|---|---|---|
| GLBファイル本文取得 | Drive v3 | `GET /drive/v3/files/{id}?alt=media&supportsAllDrives=true` | `https://www.googleapis.com/auth/drive.readonly`（最低） もしくは該当ファイルへの `drive.file` | 共有ドライブ対応時は `supportsAllDrives=true` を常に付与 |
| 画像サムネ取得 | Drive v3 | `GET /drive/v3/files/{id}?fields=thumbnailLink` | `drive.readonly` | `thumbnailLink` は公開設定・権限に依存 |
| 親フォルダ内の画像列挙 | Drive v3 | `GET /drive/v3/files?q='PARENT' in parents and mimeType contains 'image/'` | `drive.readonly`（または `drive.metadata.readonly`） | 共有ドライブ配下なら `includeItemsFromAllDrives=true` も検討 |
| スプレッドシート作成 | Sheets v4 | `POST /v4/spreadsheets` | `https://www.googleapis.com/auth/spreadsheets` | タイトル/初期シートの作成 |
| シート追加/タブ操作 | Sheets v4 | `POST /v4/spreadsheets/{id}:batchUpdate` | `spreadsheets` | `addSheet`, `updateCells` など |
| 値の読み取り | Sheets v4 | `GET /v4/spreadsheets/{id}/values/{range}` | `spreadsheets.readonly`（読取専用時） | `Captions!A2:J` 等の範囲 |
| 値の更新 | Sheets v4 | `PUT /v4/spreadsheets/{id}/values/{range}?valueInputOption=RAW` | `spreadsheets` | 単一セル更新やヘッダー初期化 |
| 行削除（設計） | Sheets v4 | `batchUpdate` で `deleteDimension` | `spreadsheets` | 復活防止と相性で tombstone を併用可 |
| 生成したシートをフォルダへ移動 | Drive v3 | `PATCH /drive/v3/files/{id}?addParents=PARENT` | `drive` | なくても動作は可能（整理目的） |

**推奨スコープ構成（例）**  
- 読み取り中心: `drive.readonly` + `spreadsheets.readonly`  
- 編集フル機能: `drive.file`（または `drive`） + `spreadsheets`

> 注：ユーザーの共有ドライブを扱う場合は、**ドメイン/共有設定**や `supportsAllDrives=true` の付与を徹底。サムネURLは**公開設定**に依存します。

---

## 14. 運用ガイド（ミス予防・品質担保）
- **バージョン識別**：`window.LM_BUILD` を起動時にログ出力（キャッシュ混入の即時検知）。
- **例外抑止**：外部APIは `try/catch` + `console.warn('[LM]', …)`、UIはトースト/ラベルで通知。
- **非同期の徹底**：Drive/Sheets/サムネはすべて `await`、`[object Promise]` を表示に使わない。
- **選択同期**：ピン→リスト→オーバーレイ→フォームの**単方向更新**を守り、逆方向はハンドラ経由で合流。
- **CI的チェック**：出荷前に**構文検査**（`new Function(code)` など）と**不可視文字検査**を必ず通す。

