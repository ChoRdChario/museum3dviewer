# LociMyu 開発系統について

## 新系統（本番想定）
- **ESM/CDN ベース**
- 主なファイル: `boot.esm.cdn.js`, `viewer.module.cdn.js`, `gauth.module.js`（meta対応版）
- 特徴:
  - Google Drive API + Bearer Token による GLB 読み込み（CORS 安全）
  - Google Identity Services を `<meta>` から client_id / api_key を取得して利用
  - Google Sheets / Drive の実 API に接続

## 旧系統（開発・検証用）
- **IIFE / Classic スクリプト ベース**
- 主なファイル: `viewer.js`, `app_boot.js`, `sheets_api.js`, `utils_drive_images.js`
- 特徴:
  - `uc?export=download` 経由で GLB を読み込む（GitHub Pages 環境では CORS 問題あり）
  - 認証はプレースホルダ client_id を利用（そのままでは本番不可）
  - 画像やシートはスタブ実装（ダミー動作）

## 注意点
- **通常は新系統を利用してください**。旧系統は検証や一時的なバックアップ用途にのみ残してあります。
- 将来的には旧系統は削除予定です。
- `index.html` は新系統のみをロードする構成になっています。
