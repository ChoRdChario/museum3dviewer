// gauth.js — GIS token auth with exported setupAuth/getAccessToken
/* global google */
const CLIENT_ID = window.GAUTH_CLIENT_ID || "595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com";
const SCOPE = "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets";

const GAUTH = {
  token: null,
  chip: null,
  updateChip(){
    if (!this.chip) this.chip = document.getElementById('authChip');
    if (!this.chip) return;
    if (this.token?.access_token){
      this.chip.textContent = "Signed in";
      this.chip.classList.add("signed");
    }else{
      this.chip.textContent = "Sign in";
      this.chip.classList.remove("signed");
    }
  },
  attachChipEvents(){
    if (!this.chip) this.chip = document.getElementById('authChip');
    if (!this.chip) return;
    this.chip.addEventListener('click', async ()=>{
      if (this.token?.access_token){
        // sign-out (revoke)
        try{ google?.accounts?.oauth2?.revoke?.(this.token.access_token, ()=>{}); }catch(_){}
        this.token = null;
        this.updateChip();
        window.dispatchEvent(new CustomEvent('lmy:auth-changed', {detail:{signedIn:false}}));
      }else{
        try{
          await this.signIn();
          window.dispatchEvent(new CustomEvent('lmy:auth-changed', {detail:{signedIn:true}}));
        }catch(e){
          console.warn('[gauth] signIn failed', e);
        }
      }
    }, { once: false });
  },
  async signIn(){
    if (!window.google || !google.accounts || !google.accounts.oauth2){
      throw new Error("Google Identity Services not loaded");
    }
    return new Promise((resolve, reject)=>{
      const client = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPE,
        prompt: "",
        callback: (tok)=>{
          if (tok?.access_token){
            this.token = tok;
            this.updateChip();
            resolve(tok);
          }else{
            reject(new Error("no token"));
          }
        }
      });
      client.requestAccessToken();
    });
  },
  async getAccessToken(){
    if (this.token?.access_token) return this.token.access_token;
    await this.signIn();
    return this.token?.access_token || null;
  }
};

/**
 * Initialize auth UI and return an interface used by callers.
 * Usage from app_boot.js:
 *   import { setupAuth } from './gauth.js?v=...';
 *   const auth = await setupAuth();
 *   const token = await auth.getAccessToken();
 */
export async function setupAuth(){
  // wait DOM to wire chip
  if (document.readyState === 'loading'){
    await new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }
  GAUTH.updateChip();
  GAUTH.attachChipEvents();
  // Expose to other modules (optional)
  window.__GAUTH__ = GAUTH;
  return {
    getAccessToken: ()=> GAUTH.getAccessToken(),
    signIn: ()=> GAUTH.signIn(),
    onAuthChanged: (fn)=> window.addEventListener('lmy:auth-changed', fn),
  };
}

export async function getAccessToken(){
  return GAUTH.getAccessToken();
}

// Also provide default (backward compat)
export default { setupAuth, getAccessToken };
