# LociMyu 3D Caption Tool — 統合ドキュメント（2025-10-12 18:20 改訂）

この版は**現行コードに合わせて再同期**し、廃止UIや未配線点を解消する実装方針を反映しました。

## 変更サマリ
- Attach/Detachボタンを**撤廃**（HTMLから削除）。画像は**サムネクリックでAttach**／**リスト×でDetach**。
- **ピンカラーchips**（`#pin-colors`）を生成＆配線。クリックで `currentPinColor` を更新、選択ピンがあれば**即時更新→Sheets反映→3D再生成**。
- **ピンフィルタchips**（`#pin-filter`）を生成＆配線。`All / Selected / Color` を用意。Colorは **現在の`currentPinColor`** を使ってフィルタ。
- **オーバーレイ±**を**左上固定**で追加。拡縮レンジ **0.6〜2.0**、拡縮しても位置不変（トップバー左）。

## 実装ノート
- フィルタ適用は `applyFilter(mode,color)` → **リスト `.is-hidden`** 切替 → **3Dピン再構築**（`clearPins`→`addPinMarker`）。
- カラー更新は `updateCaptionForPin` → リスト境界線色更新 → `removePinMarker` → `addPinMarker` → `setPinSelected`。
- オーバーレイ拡縮は `applyOverlayZoom(id,z)` で **min/maxWidth** を調整（スケールではない）。±は**トップバーの左側**に注入。

## ファイル
- `index.updated.html` … 死にUI除去済
- `boot.esm.cdn.updated.js` … chips/フィルタ/±実装入り（フルファイル）
- その他：`viewer.module.cdn.js`, `gauth.module.js`, `leader.css`, `app.css`, `locimyu.config.js` は変更なし

