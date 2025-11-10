
# ストレングラー方式 仕様ドラフト（保存まわり vNext）
**Version:** 20251110-164839  
**Scope:** マテリアル保存（opacity から開始）／Sheets 429/400耐性／既存UI・描画は不変

---

## 0. 目的と原則
- 目的：**保存責務の一本化**と**レース/429/400の根絶**。UIやThreeは極力触らず、「保存コア」だけ差し替える。
- 原則：
  1) **gid依存**（タイトル非依存）  
  2) `__LM_MATERIALS` は**ヘッダー専用**、データ行は**禁止**  
  3) データは常に `__LM_MAT_<gid>` へ **append**  
  4) **イベント順序の吸収**（文脈未確定の操作はキュー）  
  5) **A1表現は専用ビルダで統一**（クォート・URLエンコード込み）

## 1. 分割境界（Strangler seam）
- vNext API（既存からはこの3つだけを呼ぶ）
  - `persistVNext.setContext({ spreadsheetId, sheetGid, user? })`
  - `persistVNext.saveMaterial({ materialKey, opacity })`
  - `persistVNext.loadMaterials({ sheetGid? })`
- 既存の Sheets 直叩きは禁止。`lm:sheet-context` と UIイベントだけ薄いアダプタで接続。

## 2. データモデル & シート設計
### 2.1 ヘッダーシート（固定）
- シート名：`__LM_MATERIALS`（**A1の1行のみ**）  
- 列：`timestamp, updatedBy, materialKey, opacity`（順序固定）  
- 書き込み禁止（未作成なら vNext が一度だけ作成→PUT）。

### 2.2 データシート（gidごと）
- シート名：`__LM_MAT_<gid>`（例 `__LM_MAT_252971566`）  
- **append-only**（`INSERT_ROWS` / RAW）。  
- 読み取りは**最新行優先**（materialKeyでreduce）。

## 3. API仕様（vNextコア）
```ts
type Ctx = {{ spreadsheetId: string; sheetGid: number; user?: string }};
type MaterialRow = {{
  timestamp: string;   // ISO
  updatedBy: string;
  materialKey: string;
  opacity?: number;    // 0..1
}};

persistVNext.setContext(ctx: Ctx): void
persistVNext.saveMaterial(row: Partial<MaterialRow> & {{ materialKey: string }}): Promise<void>
persistVNext.loadMaterials(opts?: {{ sheetGid?: number }}): Promise<MaterialRow[]>
persistVNext.attachDefaultAdapters(opts?): void  // 任意：スライダ・イベント配線
persistVNext.enableDebug(on: boolean): void
```

### 3.1 状態機械
- `INIT` → `CONTEXT_PENDING`（`setContext`待ち）→ `READY`。  
- `DEGRADED`：429/5xx 時に内部キュー遅延・再送。

### 3.2 リトライ／バックオフ
- 429/5xx：指数バックオフ（`2^n * 400ms + jitter`, 上限約10s）最大5回。  
- 400（すでに存在等）は**冪等成功扱い**に降格。

### 3.3 A1ビルダー
- 単一点関数に集約：**クォート付きシート名** + **encodeURIComponent** + **絶対参照**。

## 4. イベント配線（アダプタ）
- `window.addEventListener('lm:sheet-context', e => persistVNext.setContext(e.detail))`
- 透明度スライダ：`input` は描画のみ、`change` で保存。**300ms デバウンス**。

## 5. 段階差し替え（Plan）
1) **Phase 0**: 本 bundle を追加。`lm:sheet-context` とスライダのアダプタだけ接続。  
2) **Phase 1**: 旧保存呼び出しを no-op or vNext に置換。  
3) **Phase 2**: 読み込みを vNext に統合。  
4) **Phase 3**: 他プロパティ（chroma 等）を1つずつ導入。

## 6. ログ
- `[persist.vNext]` 接頭辞で統一：`ctx READY`, `header ensured`, `append -> __LM_MAT_<gid>`, `429 backoff n=…` 等。  
- `?persistDebug=1` で詳細ログON。

## 7. DoD
- `__LM_MATERIALS` は **A1のみ**設定、それ以外は不変。  
- スライダ操作で `__LM_MAT_<gid>` に **1操作=最大1行** の append（デバウンス済）。  
- 429が出ても UI は固まらず、最終的に保存が到達。

## 8. ロールアウト
- `window.__LM_PERSIST_VNEXT=1` で切り替え導入 → A/B → 旧コード撤去。

---

## 同梱物
- `persist.vNext.bundle.js`（コア + A1ビルダ + fetch/backoff + アダプタ）  
- 既存 `boot.esm.cdn.js` の**末尾**で読込（scriptタグ or dynamic import）。
