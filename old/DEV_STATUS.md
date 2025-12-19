# DEV_STATUS

## 概要
このリポジトリは LociMyu（Webベース3Dキャプションツール）の開発用ソースです。

2025-12-17 時点で、共有モード（Share Mode）を「非破壊閲覧（Drive/Sheets への write 0）」として実装しています。

## モード方針（重要）
### Edit Mode
- 既存どおり編集・保存が可能

### Share Mode
- `?mode=share` および互換の `?mode=view`
- **安全性の主砦は「書き込み可能な実装をロードしない」こと**
- 追加の保険として、Share専用の fetch guard が Google APIs への非GETを遮断

## エントリ構成
- `app.loader.js`
  - URLからモード判定し、entryを切り替え
  - Share: `app.share.entry.js`
  - Edit: `app.edit.entry.js`
  - `__LM_DIAG.loaded` にロード記録

- `app.share.entry.js`
  - Share側で必要な“読み取り・その場反映”のみをロード
  - 起動時に `__LM_DIAG.loaded` を用いた「禁止モジュール混入」診断を実施（UI警告あり）
  - 右上に Share バッジを表示（保存されないことの明示）

## Share Mode の許可範囲（実装済）
- GLB ロード・閲覧操作：許可
- Caption：閲覧のみ（リスト/ピン/選択/画像表示）
- Views：read-only 復元（`__LM_VIEWS` があれば適用）＋その場操作（保存なし）
- Materials：read-only 適用（`__LM_MATERIALS` があれば反映）＋その場操作（保存なし）

## Share Mode の禁止（保証対象）
- Sheets/Drive への永続化 write（POST/PUT/PATCH/DELETE 等）
- 新規 Spreadsheet / Sheet の作成
- キャプション追加・編集・削除・画像アタッチ
- シート表示名（displayName）リネーム

## Share Mode 回帰テスト（必須）
### 1) ネットワーク write が 0 であること
DevTools → Network で以下をフィルタし、**POST/PUT/PATCH/DELETE が 0件**であること：
- `sheets.googleapis.com`
- `www.googleapis.com/drive/v3`

GET のみは許可。

### 2) 禁止モジュールがロードされていないこと
Console で：
- `__LM_DIAG.loaded` を確認
- Share起動時に赤い警告（Share safety warning）が出ないこと

### 3) 期待挙動
- Views/Materials 操作はその場反映するが、リロードで保存されていない
- キャプション削除（×）ができない（UIで無効）

## Share Mode 禁止モジュール（目安）
Share entry から **ロードしてはいけない**代表：
- `boot.esm.cdn.js`
- `save.locator.js`
- `materials.sheet.persist.js`
- `caption.sheet.bridge.js`
- `caption.sheet.selector.js`
- `sheet-rename.module.js`
- `views.ui.controller.js`
- `auto.apply.soft.patch.js`
- `glb.btn.bridge.v3.js`

（正は `app.share.entry.js` の `__LM_SHARE_FORBIDDEN` を参照）

