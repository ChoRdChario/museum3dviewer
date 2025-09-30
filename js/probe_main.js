// Minimal probe: confirm type=module scripts run and relative path works
console.log('[probe] module script executed');
const badge = document.getElementById('badge'); badge.style.display='inline-block';
const log = document.getElementById('log'); log.style.display='block'; log.textContent += '\n[probe] ok: module executed';
