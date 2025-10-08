// gauth.module.js
export async function setupAuth(sel){
  const chip = document.querySelector(sel);
  if (!chip) throw new Error('[gauth] no auth chip/button found');

  let signedIn = false;
  const sync = ()=> chip.textContent = signedIn ? 'Signed in' : 'Sign in';

  chip.addEventListener('click', ()=>{
    signedIn = !signedIn;
    sync();
  });

  sync();
}
