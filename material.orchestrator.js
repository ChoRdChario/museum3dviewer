// material.orchestrator.js (rehome-only) v2025-10-29
// 目的: 下部に漏れた Material UI (#pm-*) を、Materialタブ内の
// 「Pick a material, then set its opacity. …」の直後に再配置する。
// 機能追加や保存は一切行わない。

(function(){
  'use strict';

  const log  = (...a)=>console.debug('[mat-orch]', ...a);
  const warn = (...a)=>console.warn('[mat-orch]', ...a);

  // --- Material パネル特定 ---
  function resolveMaterialPanel(){
    // タブボタン → aria-controls でパネル逆引き
    const tabBtn = document.querySelector(
      '#tab-material,[data-tab-target="material"],button[role="tab"][data-tab="material"]'
    );
    let panel = null;
    if (tabBtn){
      const pid = tabBtn.getAttribute('aria-controls');
      if (pid) panel = document.getElementById(pid);
    }
    // フォールバック（既存のID/クラスに広く対応）
    panel = panel || document.querySelector(
      '[role="tabpanel"]#tab-material, .lm-tabpanel#tab-material, #panel-material, .tab-panel-material'
    );
    return panel || null;
  }

  // --- 「Pick a material…」説明行（またはその周辺）を探す ---
  function findPickDescAnchor(panel){
    if (!panel) return null;
    // パネル内のテキストを走査して "Pick a material" を含む要素を探す（英字・大文字小文字無視）
    const needle = 'pick a material';
    const nodes = panel.querySelectorAll('*');
    for (const el of nodes){
      // テキスト量の多いコンテナを優先
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt.includes(needle)){
        return el; // この要素の直後にホストを置く
      }
    }
    return null;
  }

  // --- 受け皿ホスト作成（説明行の直後） ---
  function ensureHost(panel){
    let host = panel.querySelector('#pm-controls-host');
    if (host) return host;

    const anchor = findPickDescAnchor(panel);
    host = document.createElement('div');
    host.id = 'pm-controls-host';
    // 親のレイアウトを崩さないため、display: contents 相当
    host.style.display = 'contents';

    if (anchor && anchor.parentNode){
      // 説明要素の直後に差し込む
      if (anchor.nextSibling) anchor.parentNode.insertBefore(host, anchor.nextSibling);
      else anchor.parentNode.appendChild(host);
    } else {
      // アンカーが見つからない場合はパネル末尾
      panel.appendChild(host);
    }
    return host;
  }

  // --- 下部に漏れたUIを回収してホストへ移動 ---
  function rehomeControls(){
    const panel = resolveMaterialPanel();
    if (!panel) { log('material panel not found; skip'); return; }

    const host = ensureHost(panel);

    // 受け入れるコントロールの候補（既知ID/別名）
    const selectors = [
      '#pm-material',
      '#pm-opacity-range',
      '#pm-opacity-value',
      '#pm-refresh',
      '#pm-refresh-btn'
    ];

    const moved = [];
    for (const sel of selectors){
      const list = Array.from(document.querySelectorAll(sel));
      for (const el of list){
        if (!el) continue;
        // すでにパネル内なら無視
        if (panel.contains(el)) continue;
        try {
          host.appendChild(el);
          moved.push(sel);
        } catch(e) {
          warn('failed to move', sel, e);
        }
      }
    }
    if (moved.length) log('re-homed controls:', moved);
    else log('no leaked controls found');
  }

  // --- 起動（描画後/scene-ready/model-readyのあとに再試行） ---
  function bootOnce(){
    rehomeControls();
  }
  if (document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ()=> setTimeout(bootOnce, 0));
  } else {
    setTimeout(bootOnce, 0);
  }
  window.addEventListener('lm:scene-ready', ()=> setTimeout(rehomeControls, 50));
  window.addEventListener('lm:model-ready', ()=> setTimeout(rehomeControls, 50));
})();
