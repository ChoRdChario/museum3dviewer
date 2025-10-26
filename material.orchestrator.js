// material.orchestrator.js
// LociMyu Material Orchestrator
// 役割：GLBが「本当に」載った後に一度だけ名前付きマテをセレクトへ投入し、スライダ配線。
// - 主要トリガ: lm:model-ready（bridge から）
// - バックアップ: lm:scene-ready の後に短時間ポーリング

(() => {
  const LOG_TAG = '[lm-orch]';
  const log = (...a) => console.log(LOG_TAG, ...a);

  log('loaded');

  // viewer.module.cdn.js を遅延importし、キャッシュして再利用
  async function getViewerMod() {
    if (window.__viewer_mod_cache) return window.__viewer_mod_cache;
    try {
      const mod = await import('./viewer.module.cdn.js');
      window.__viewer_mod_cache = mod;
      return mod;
    } catch {
      return {};
    }
  }

  // 名前列挙（viewer API → scene 走査の順で試す）
  async function collectMaterialNames() {
    let names = [];
    try {
      const mod = await getViewerMod();
      const arr = mod.listMaterials?.() || [];
      names = arr.map((r) => r?.name).filter(Boolean);
    } catch {}
    if (names.length === 0) {
      const s = window.__LM_SCENE;
      const set = new Set();
      s?.traverse?.((o) => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material])
          .forEach((m) => m?.name && set.add(m.name));
      });
      names = [...set];
    }
    // #0, #1 ... の匿名は除外 & 重複排除
    return [...new Set(names)].filter((n) => !/^#\d+$/.test(n));
  }

  // セレクトへ投入（idempotent）
  function fillSelect(names) {
    const sel = document.getElementById('pm-material');
    if (!sel) return false;
    const cur = sel.value;
    sel.innerHTML = '<option value="">— Select material —</option>';
    for (const n of names) {
      const o = document.createElement('option');
      o.value = n; o.textContent = n;
      sel.appendChild(o);
    }
    if (cur && names.includes(cur)) sel.value = cur;
    return names.length > 0;
  }

  // 適用：名前一致の全マテに opacity を当てる
  async function setOpacityByName(name, v) {
    const val = Math.max(0, Math.min(1, Number(v)));
    let count = 0;
    const mod = await getViewerMod();
    if (typeof mod.applyMaterialPropsByName === 'function') {
      count = mod.applyMaterialPropsByName(name, { opacity: val }) || 0;
    } else {
      const s = window.__LM_SCENE;
      s?.traverse?.((o) => {
        if (!o.isMesh || !o.material) return;
        (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
          if ((m?.name || '') === name) {
            m.transparent = val < 1;
            m.opacity = val;
            m.depthWrite = val >= 1;
            m.needsUpdate = true;
            count++;
          }
        });
      });
    }
    return count;
  }

  // その名前の最初の現在不透明度
  function getOpacityByName(name) {
    let out = null;
    const s = window.__LM_SCENE;
    s?.traverse?.((o) => {
      if (out !== null) return;
      if (!o.isMesh || !o.material) return;
      (Array.isArray(o.material) ? o.material : [o.material]).some((m) => {
        if ((m?.name || '') === name) { out = Number(m.opacity ?? 1); return true; }
        return false;
      });
    });
    return out == null ? 1 : Math.max(0, Math.min(1, out));
  }

  // スライダ/セレクト配線（多重でも害なし）
  function wireUIOnce() {
    const sel = document.getElementById('pm-material');
    const rng = document.getElementById('pm-opacity-range');
    const out = document.getElementById('pm-opacity-val');
    if (!(sel && rng && out)) return;

    const onChange = () => {
      const n = sel.value;
      const v = n ? getOpacityByName(n) : 1;
      rng.value = v;
      out.textContent = v.toFixed(2);
    };
    const onInput = () => {
      const n = sel.value;
      if (!n) return;
      const v = Number(rng.value || 1);
      out.textContent = v.toFixed(2);
      setOpacityByName(n, v);
    };

    sel.removeEventListener?.('__orch_change', onChange);
    rng.removeEventListener?.('__orch_input', onInput);

    sel.addEventListener('change', onChange);
    rng.addEventListener('input', onInput, { passive: true });

    // “印” を付けて二重配線防止
    sel.addEventListener('__orch_change', onChange);
    rng.addEventListener('__orch_input', onInput);

    // 初期同期
    onChange();
  }

  // 一発実行: 集めて入れて、配線
  let lastCount = -1;
  async function fillOnceAndWire() {
    const names = await collectMaterialNames();
    const ok = fillSelect(names);
    if (ok && names.length !== lastCount) {
      log('filled', names.length, names);
      lastCount = names.length;
    }
    if (ok) wireUIOnce();
    return ok;
  }

  // --- 起動シーケンス ---
  // 最優先: モデル実体が載ったら一発
  document.addEventListener('lm:model-ready', () => {
    (async () => {
      if (await fillOnceAndWire()) return;
      // 念のためのごく短い再試行
      let tries = 0;
      const iv = setInterval(async () => {
        tries++;
        if (await fillOnceAndWire() || tries >= 20) clearInterval(iv); // 最大 ~4s
      }, 200);
    })();
  }, { once: true });

  // 互換: scene-ready 後にもバックアップの短ポーリング
  document.addEventListener('lm:scene-ready', () => {
    log('scene-ready');
    let tries = 0;
    const iv = setInterval(async () => {
      tries++;
      if (await fillOnceAndWire() || tries >= 30) clearInterval(iv); // 最大 ~6s
    }, 200);
  }, { once: true });
})();
