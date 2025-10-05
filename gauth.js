// Minimal 'auth' chip that flips to 'Signed in' for now (GIS移行前の暫定)
// Exports: setupAuth(app) -> { isSignedIn(), getToken() }
export function setupAuth(app){
  const chip = document.getElementById('authChip');
  let signedIn = false;
  function refresh(){
    chip.className = 'chip ' + (signedIn ? 'ok' : 'warn');
    chip.textContent = signedIn ? 'Signed in' : 'Sign in';
    chip.title = signedIn ? 'サインイン済み' : 'Googleにサインイン';
  }
  chip.onclick = async ()=>{
    // ここで本来はGISのトークン取得。今は疑似的に即Signed-in化。
    signedIn = !signedIn;
    refresh();
    app.events?.dispatchEvent(new CustomEvent('auth:state', {detail:{signedIn}}));
  };
  refresh();
  return {
    isSignedIn: ()=>signedIn,
    getToken: ()=>null
  };
}
