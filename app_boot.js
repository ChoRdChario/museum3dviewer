import { setupAuth } from './gauth.js'
import { setupUI } from './ui.js'

async function boot(){
  console.log('[auth] ready')
  await setupAuth()
  await setupUI()
  const bootEl = document.getElementById('boot')
  if (bootEl) bootEl.style.display = 'none'
}
boot()
