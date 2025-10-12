# LociMyu 3D Caption Tool — 統合ドキュメント

**版**: 2025-10-12 10:07:02Z
**本書は唯一の真実源（SSOT）です。**

## 1. 目的
- 3Dモデル（GLB）にピンを設置し、学芸員向けキャプション（タイトル/本文/色/座標/画像添付）を管理。
- 台帳は Google Sheets（`Captions` シート）。画像は GLB の親フォルダ配下（Google Drive）。

## 2. 機能（現状）
- GLB 読込（Local / URL / Drive）
- ピン追加・選択・削除
- キャプションリスト表示・フォーム編集・オーバーレイ表示
- 画像添付/デタッチ（準備中：M2で実装強化）

## 3. ファイル構成（要点）
- `index.html` … エントリ
- `boot.esm.cdn.js` … アプリ本体
- `viewer.module.cdn.js` … Three.js ビューア
- `gauth.module.js` … Google 認証
- `app.css` / `leader.css` … スタイル
- `LOCIMYU_UNIFIED_README.md` … 本ドキュメント

## 4. データモデル（Captions）
`[id, title, body, color, x, y, z, imageFileId, createdAt, updatedAt]`

## 5. 外部連携（権限最小）
- Drive: `drive.readonly` or `drive.file`
- Sheets: `spreadsheets.readonly` / `spreadsheets`

## 6. 現在の変更（M1）
- リスト選択強調（`.is-selected`）を実装
- `__lm_selectPin` ラップでリスト/ピンの選択同期
- フォーム入力はデバウンス保存（300ms）で `updateCaptionForPin` に一元化
- オーバーレイ × ボタンで安全に閉じる（選択は維持）
- 画像サムネの Promise 漏れ防止（安全ヘルパ）
- 構文崩れ：余剰 `}` の除去

## 7. 次の開発（M2〜）
- 画像アタッチ/デタッチUIの整備
- 削除の永続化（tombstone）
- 三重 import の解消、GLB ローダ強化

## 8. 運用
- `window.LM_BUILD` のログでバージョン特定
- バージョンクエリ（`?v=`）でキャッシュ回避
- 出荷時に本書を必ず更新
