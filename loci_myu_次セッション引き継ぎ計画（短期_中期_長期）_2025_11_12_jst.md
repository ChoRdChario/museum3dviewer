# LociMyu 次セッション引き継ぎ計画（短期/中期/長期）
**日時**: 2025-11-12 (JST)

---

## TL;DR（バイブコーディング用サマリ）
- **短期（〜数日）**: 認可とGLB表示の“土台”を完全安定化 → `__LM_MATERIALS` ヘッダ生成の一本化 → sheet-context の安定化。
- **中期（〜2〜3週）**: マテリアルUI↔保存（Sheets）配線の整流、in-flight/キャッシュ/デバウンスでI/O最適化、ログ整備＆Feature Flagで段階展開。
- **長期（〜1〜2ヶ月）**: モジュール境界の再設計、E2E/負荷テスト、モバイルUI最適化、エラーバジェットと監視運用。

---

## 現状の合意ゴール（再掲）
1. **`__LM_MATERIALS` ヘッダ生成の一本化（最優先）**
2. **sheet-context の安定化（過剰トリガ抑制）**
3. **persist 層の in-flight 結合＋短期キャッシュ**
4. **保存トリガの移譲＋デバウンス**（UIの即時反映は維持）
5. **計測向けログの整備**
6. **Feature Flag による安全展開**

---

## 短期（〜数日）
### 0) 土台安定化（今回の最小 `boot.esm.cdn.js` の方針固定）
- **client_id 取得順序の固定**: `window.GIS_CLIENT_ID` → `window.__LM_CLIENT_ID` → `<meta name="google-signin-client_id">` → `<meta name="gis-client-id">` → `<meta name="client_id">` → `#app.dataset`。
- **GISの単一ロード & single-flight**: マルチ初期化の抑止。
- **公開API**: `window.__lm_getAccessToken()`（成功ログ: `signin ok`）。
- **GLB解決**: Drive共有URL→`files/{id}?alt=media`→Blob→`lm:model-url` でビューワへ受け渡し。
- **受け側契約**: ビューワは `window.addEventListener('lm:model-url', e => loader.load(e.detail))` を実装して表示。
- **チェックリスト**:
  - [ ] `__LM_DEBUG.pickClientIdFromDOM()` で client_id が解決される
  - [ ] Sign in → `GIS loaded` → `signin ok`
  - [ ] GLB入力 → `glb resolved -> blob` → 表示

### 1) `__LM_MATERIALS` ヘッダ生成の一本化
- **関数**: `ensureMaterialsHeader()`
- **順序**: `ensureMaterialsSheet()`（無ければ addSheet）→ `putHeader("__LM_MATERIALS!A1:Q1")`（一度だけ）。
- **ガード**: `window.__LM_MATERIALS_READY__` + single-flight。
- **完了条件**: 初回のみ PUT 200、以降はスキップログ。

### 2) sheet-context 安定化
- **橋**: `sheet.ctx.bridge` が `{spreadsheetId, sheetGid}` を直近保持、値が変わる時だけ `lm:sheet-context` 発火。
- **ポーリング**: 必要なら 3–5s、初回のみ即時 1 回。
- **完了条件**: 余計な再発火の消滅（ログ件数=変更回数）。

---

## 中期（〜2〜3週）
### 3) persist 層の in-flight + キャッシュ
- **重複束ね**: `inflightMap(url)`: 同一URLへの同時 GET/PUT/POST を一つの Promise に統合。
- **短期キャッシュ**: `values.get` を範囲キーで 5s キャッシュ。
- **完了条件**: 同一URLの同時呼び出しが 1 リクエストになる（ログで確認）。429 が消失。

### 4) 保存トリガ移譲 + デバウンス
- **UI**: input の即時描画は維持。
- **保存経路**: すべて `material.state.sheet` に集約。300–500ms デバウンス。
- **キー**: `rowKey = materialKey + sheetGid`（一致あれば update、無ければ append）。
- **完了条件**: スライダ連打でも保存が数回に集約。`__LM_MATERIALS` に upsert 反映。

### 5) 計測向けログ整備
- **タグ**: `[ctx] set {id,gid}` / `[materials] ensure sheet` / `[materials] header put` / `[persist] get/update/append` / `[state] queued-save`。
- **可観測性**: シート名・range を短い1行ログに整形。

### 6) Feature Flag 展開
- `window.__LM_FEATURES__ = { materialsHeaderGuard, ctxStable, persistInflight, sheetDebounce }`
- 旧挙動↔新挙動の切替を即時可能に。

---

## 長期（〜1〜2ヶ月）
### A) モジュール境界の再設計
- **layers**: `auth` / `glb-resolver` / `sheet-context` / `persist` / `state` / `ui-orchestrator`。
- **契約**: すべてイベント or 明示API に統一（副作用依存を排除）。

### B) 回帰防止の自動テスト
- **Unit**: rangeエンコード・ヘッダPUT順序・single-flight。
- **Integration**: “初回起動→ヘッダ生成→保存”のシナリオ。
- **E2E（Playwright）**: Sign in→GLBロード→UI操作→保存→再描画確認。

### C) 性能とUX
- **モバイル**: ボトムシートUIの再検討（占有率 ≈ 15% 目標）。
- **パフォーマンス**: GLBのストリーミング/プログレッシブ読込、メモリ使用監視。

### D) 運用
- **エラーバジェット**: 429/4xx のしきい値設定、通知（Console 収集 or GA/自前 Beacon）。
- **リリース**: Feature Flag と Canary（% rollout）。

---

## 実装順（再確認）
1. **土台**（この版の `boot.esm.cdn.js` を固定）
2. **Step 1** ヘッダ一本化
3. **Step 2** sheet-context 安定化
4. **Step 3** persist in-flight/キャッシュ
5. **Step 4** 保存デバウンス
6. **Step 5** ログ整備
7. **Step 6** フラグ展開

---

## 受け側インターフェース（ビューワ）
- 受信: `window.addEventListener('lm:model-url', e => loader.load(e.detail))`
- 送信（既存）: `window.dispatchEvent(new CustomEvent('lm:glb-load', {detail:url}))`
- 認可: `await window.__lm_getAccessToken()`

---

## スモークテスト・ランブック
1. **client_id 確認**: `__LM_DEBUG && __LM_DEBUG.pickClientIdFromDOM()` → 文字列が返る
2. **Sign in**: `GIS loaded` → `signin ok`
3. **GLBロード**: 共有URL→`glb resolved -> blob`→`lm:model-url` → 表示
4. **初回保存系**: GLB表示後に `ensureMaterialsHeader()` が一度だけ PUT（200）

---

## 既知のリスク / 回避策
- **meta欠落**: client_id が空→HTMLに `<meta name="google-signin-client_id" content="...">` を追加
- **429**: in-flight/キャッシュ/デバウンスまで先に入れて軽減
- **二重Three.js**: importmap/バンドル経路の統一（次フェーズで）

---

## 次セッションToDo（チェックリスト）
- [ ] `boot.esm.cdn.js` の現行版を固定（土台）。
- [ ] `ensureMaterialsHeader()` 実装＋ログ。
- [ ] `sheet.ctx.bridge` の過剰発火抑制。
- [ ] `persist` in-flight / 5s キャッシュ。
- [ ] `material.state.sheet` 経由の保存デバウンス（300–500ms）。
- [ ] ログタグの統一＆最小化。
- [ ] Feature Flag の導入。

---

### 付録A: ログの見方（例）
```
[ctx] set {id:..., gid:...}
[materials] ensure sheet → OK(200)
[materials] header put A1:Q1 → OK(200) (first only)
[persist] get __LM_MATERIALS!A1:Q1 → HIT(cache) / MISS(fetch)
[state] queued-save {key: texture02@gid123, debounce: 350ms}
```

### 付録B: Rollback指針
- 重大問題時は Feature Flag をOFF → 旧挙動に即時戻す。
- `boot.esm.cdn.js` は土台を維持し、保存系のみロールバック。

