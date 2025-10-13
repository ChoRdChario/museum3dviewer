LociMyu 3D Caption Tool — 統合ドキュメント（ベースライン復旧点 2025-10-13 14:07）
================================================================================

この版は**ユーザー提供の安定版ZIP（9ファイル）**をベースとして、実装状態を棚卸しし、今後の差分実装（ピンカラー／フィルタ再導入 ほか）の土台にします。

## 1. 入力パッケージ（9ファイル）
# Baseline package inventory

- LOCIMYU_UNIFIED_README.md (1626 bytes)
- app.css (4032 bytes)
- boot.esm.cdn.js (40886 bytes)
- boot.esm.js (2406 bytes)
- favicon.ico (97 bytes)
- gauth.module.js (3469 bytes)
- index.html (7057 bytes)
- leader.css (311 bytes)
- locimyu.config.js (587 bytes)
- viewer.module.cdn.js (6328 bytes)

# Feature markers scan
- LOCIMYU_UNIFIED_README.md: {'overlay_zoom': ['applyOverlayZoom'], 'pin_color_ui': ['pin-colors', 'currentPinColor'], 'pin_filter_ui': ['pin-filter', 'applyFilter', 'filter', 'Filter']}
- app.css: {'pin_filter_ui': ['filter']}
- boot.esm.cdn.js: {'overlay_zoom': ['applyOverlayZoom'], 'pin_color_ui': ['pin-colors', 'pinColor', 'renderColorChips', 'currentPinColor'], 'pin_filter_ui': ['pin-filter', 'applyFilter', 'applyColorFilter', 'filter', 'Filter'], 'shift_click_add': ['onCanvasShiftPick', 'Shift'], 'sheets_rename': ['rename', 'updateSheetProperties', 'batchUpdate'], 'sheets_delete_sheet': ['deleteDimension']}
- index.html: {'pin_color_ui': ['pin-colors'], 'pin_filter_ui': ['pin-filter', 'filter', 'Filter'], 'attach_detach_buttons': ['デタッチ']}
- viewer.module.cdn.js: {'pin_color_ui': ['pinColor'], 'pin_filter_ui': ['filter', 'Filter'], 'shift_click_add': ['onCanvasShiftPick', 'Shift', 'shift']}

## 2. 現状把握（コード走査の要点）
- **オーバーレイ拡縮UI**: マーカー `overlay-zoom` / `applyOverlayZoom` の痕跡: True
- **ピンカラーUI**: `pinColor` / `currentPinColor` / `renderColorChips` の痕跡: True
- **ピンフィルタUI**: `pin-filter` / `applyFilter` / `applyColorFilter` の痕跡: True
- **画像 Attach/Detach ボタン**: `btnAttachImage` / `btnDetachImage` の痕跡: True
- **Shift+クリックでピン追加**: `onCanvasShiftPick` ほかの痕跡: True
- **シート名変更/削除**: `updateSheetProperties` / `deleteSheet` の痕跡: True / True

> 注: 上記は静的スキャンによるヒントです。実行時の配線（イベントバインド・関数参照切れ等）はこの後の手動テストで確定します。

## 3. 既知の方針（復旧点に合わせて）
- **Attach/Detachボタンは残存**: 本ベースでは**ボタンがある状態**。次の更新で**サムネクリックAttach＋プレビュー×Detach**に統一。
- **ピンカラー/フィルタ**: 本ベースでは**未実装 or 未配線**。次の更新で**8色chips＋複数色フィルタ**を復帰。
- **Shift+クリック**: ベースで配線が落ちている可能性あり。`onCanvasShiftPick()` の再配線を行う。
- **シート切替時の状態リセット**: `clearPins()`／オーバーレイ閉鎖が不足の可能性。ロード時に必ずリセットする。

## 4. 次の作業（このREADMEからのToDo）
1. **UI整備**: Attach/Detachボタン撤廃、色chipsとフィルタchipsを`#pin-picker` / `#pin-filter`に実装。
2. **3D連動**: `pinFilterChange` イベント → viewer 側のピン `visible` 切替を確認・同期。
3. **保存経路の点検**: `updateCaptionForPin()` の呼び出しと `rowCache` 同期を一本化（特に色変更・画像デタッチ）。
4. **シート切替の完全リセット**: `loadCaptionsFromSheet()` 冒頭で `clearPins()`・選択解除・オーバーレイ閉鎖。
5. **Shift+クリック**: `onCanvasShiftPick()` のハンドラを一度だけ配線（重複防止フラグ）。

## 5. 互換・既知の制約
- Three.js の **多重import警告**は機能には影響小。将来の「import一本化」タスクで解消。
- HEICの**元解像度表示**は当面見送り、代わりに**Open original**リンクでDrive原本を開く導線を提供。

## 6. 参照
- 直前セッション版の README（2025‑10‑12 改訂）: Attach/Detachボタン撤廃・chips/フィルタ・拡縮の設計ノートを参照。

