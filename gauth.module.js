// gauth.module.js — Google Identity Services token (scoped) with robust handling
let accessToken = null;
let tokenClient = null;
let lastError = null;

const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/drive.file',    // create/update files created/opened with the app
  'https://www.googleapis.com/auth/spreadsheets',  // Sheets read/write
  'https://www.googleapis.com/auth/drive.readonly' // Drive metadata (optional)
].join(' ');

function ensureGisScript(){
  return new Promise((resolve)=>{
    if (window.google?.accounts?.oauth2){ resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.onload = ()=> resolve();
    s.onerror = ()=> resolve();
    document.head.appendChild(s);
  });
}

/**
 * @param {HTMLElement} buttonEl - sign in button
 * @param {(signed:boolean)=>void} onSignedChange
 * @param {{clientId?:string, scope?:string}} opts
 */
export function setupAuth(buttonEl, onSignedChange, opts = {}){
  (async ()=>{
    await ensureGisScript();
    if (!window.google?.accounts?.oauth2){
      console.warn('[auth] GIS not available; running in stub.');
      buttonEl?.addEventListener('click', ()=> console.warn('[auth] sign-in clicked (stub)'));
      return;
    }
    const clientId = opts.clientId || window.GIS_CLIENT_ID;
    if (!clientId){
      console.error('[auth] Missing client_id. Set window.GIS_CLIENT_ID or pass opts.clientId.');
      buttonEl?.addEventListener('click', ()=> alert('Missing Google OAuth Client ID.\nSet window.GIS_CLIENT_ID or pass opts.clientId.'));
      return;
    }
    const scope = opts.scope || DEFAULT_SCOPES;

    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope,
      prompt: 'consent',             // 確実にスコープ拡張同意を要求
      include_granted_scopes: true,  // インクリメンタル許可
      callback: (resp)=>{
        lastError = null;
        if (resp?.access_token){
          accessToken = resp.access_token;
          onSignedChange?.(true);
        } else if (resp?.error){
          lastError = resp;
          console.error('[auth] token error:', resp);
          alert(formatAuthError(resp));
          onSignedChange?.(false);
        }
      }
    });

    buttonEl?.addEventListener('click', ()=>{
      lastError = null;
      tokenClient.requestAccessToken({ prompt: 'consent' });
    });
  })();
}

export function getAccessToken(){ return accessToken; }
export function getLastAuthError(){ return lastError; }

function formatAuthError(err){
  const hint = [
    '- OAuth クライアントIDが「Web アプリケーション」か確認',
    '- Authorized JavaScript origins に現在のオリジンを追加（例: https://chordchario.github.io）',
    '- OAuth 同意画面が「テスト」なら、使用アカウントを「テストユーザー」に追加',
    '- Cloud Console で Drive API / Sheets API を有効化（同一プロジェクト）',
    '- ブラウザで accounts.google.com のサードパーティ Cookie を許可',
  ].join('\n');
  try{
    const code = err?.error || err?.error_subtype || 'invalid_request';
    return `Google サインインでエラー (${code}).\n\n考えられる原因:\n${hint}`;
  }catch(_){
    return 'Google サインインで不明なエラーが発生しました。';
  }
}
