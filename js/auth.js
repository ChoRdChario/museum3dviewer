export class Auth {
  constructor(config){
    this.apiKey = config.apiKey;
    this.clientId = config.clientId;
    this.tokenClient = null;
    this.accessToken = null;
    this.isAuthed = false;
  }

  async init(){
    await new Promise(resolve => gapi.load('client', resolve));
    await gapi.client.init({
      apiKey: this.apiKey,
      discoveryDocs: [
        'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
        'https://sheets.googleapis.com/$discovery/rest?version=v4'
      ],
    });
  }

  createTokenClient(onSuccess){
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: this.clientId,
      scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/spreadsheets',
      callback: (resp)=>{
        if(resp.error){ console.error(resp); return; }
        this.accessToken = resp.access_token;
        this.isAuthed = true;
        onSuccess?.();
      },
    });
  }

  ensureAuth(onSuccess){
    if(this.isAuthed){ onSuccess?.(); return; }
    this.tokenClient.requestAccessToken({ prompt: 'consent' });
  }

  signOut(){
    if(this.accessToken){
      google.accounts.oauth2.revoke(this.accessToken, ()=>{});
      this.accessToken = null;
    }
    this.isAuthed = false;
  }
}
