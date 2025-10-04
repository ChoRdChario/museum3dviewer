// gauth.js — minimal auth helper around Google Identity Services (token mode)
/* global google */
const GAUTH = {
  clientId: window.GAUTH_CLIENT_ID || "595200751510-ncahnf7edci6b9925becn5to49r6cguv.apps.googleusercontent.com",
  scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets",
  token: null,
  initOnce: false,
  btnEl: null,
  updateChip(){
    const chip = document.getElementById('authChip');
    if (!chip) return;
    if (this.token){
      chip.textContent = "Signed in";
      chip.classList.add("signed");
    }else{
      chip.textContent = "Sign in";
      chip.classList.remove("signed");
    }
  },
  async init(){
    if (this.initOnce) return;
    this.initOnce = true;
    this.updateChip();
    // Button behavior
    this.btnEl = document.getElementById('authChip');
    if (this.btnEl){
      this.btnEl.addEventListener('click', ()=>{
        if (this.token){
          // sign-out = revoke
          if (google?.accounts?.oauth2 && this.token?.access_token){
            google.accounts.oauth2.revoke(this.token.access_token, ()=>{});
          }
          this.token = null;
          this.updateChip();
        }else{
          this.signIn();
        }
      });
    }
  },
  async signIn(){
    return new Promise((resolve, reject)=>{
      if (!window.google || !google.accounts || !google.accounts.oauth2){
        reject(new Error("GIS not loaded"));
        return;
      }
      const client = google.accounts.oauth2.initTokenClient({
        client_id: this.clientId,
        scope: this.scope,
        prompt: "",
        callback: (tok)=>{
          if (tok && tok.access_token){
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
window.__GAUTH__ = GAUTH;
document.addEventListener('DOMContentLoaded', ()=> GAUTH.init());
