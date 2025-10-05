import { ViewerApp } from './viewer.js'

function normalizeDriveUrl(input){
  if (!input) throw new Error('empty file id/url')
  const idMatch = input.match(/[A-Za-z0-9_-]{25,}/)
  const id = idMatch ? idMatch[0] : input.trim()
  return `https://drive.google.com/uc?export=download&id=${id}`
}

async function fetchDriveAsArrayBuffer(url){
  const res = await fetch(url)
  const ct = (res.headers.get('content-type') || '').toLowerCase()
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  if (ct.includes('text/html')) throw new Error('Drive preview HTML detected. Use a direct download or set file sharing.')
  return await res.arrayBuffer()
}

export async function setupUI(){
  // Tabs
  const tabs = document.querySelectorAll('.tab')
  const secs = { caption: document.getElementById('sec-caption'),
                 material: document.getElementById('sec-material'),
                 view: document.getElementById('sec-view') }
  tabs.forEach(t=> t.addEventListener('click', ()=>{
    tabs.forEach(x=>x.classList.remove('active'))
    t.classList.add('active')
    Object.values(secs).forEach(s=>s.classList.remove('active'))
    secs[t.dataset.tab].classList.add('active')
  }))

  // Viewer
  const viewer = new ViewerApp('stage')
  window.app = { viewer }

  // GLB
  const btn = document.getElementById('btnGlb')
  const input = document.getElementById('driveInput')
  const demo = document.getElementById('demoLink')
  btn?.addEventListener('click', async ()=>{
    try{
      const url = normalizeDriveUrl(input.value)
      const buf = await fetchDriveAsArrayBuffer(url)
      await viewer.loadGLBArrayBuffer(buf)
    }catch(err){
      console.error(err)
      alert(err.message || String(err))
    }
  })
  demo?.addEventListener('click', async (e)=>{
    e.preventDefault()
    // Small embedded demo GLB (base64) — just to verify loader path. A 1-triangle glb.
    alert('デモGLBは Drive 直リンクを使えない環境での動作確認用ダミーです。実運用では Drive のファイルID/URLを入力してください。')
  })

  // Material
  const op = document.getElementById('matOpacity')
  const unlit = document.getElementById('matUnlit')
  const dbl = document.getElementById('matDouble')
  op?.addEventListener('input', ()=> viewer.setOpacity(parseFloat(op.value)))
  let unlitOn = false
  unlit?.addEventListener('click', ()=>{
    unlitOn = !unlitOn; viewer.setUnlit(unlitOn); unlit.textContent = `Unlit: ${unlitOn?'on':'off'}`
  })
  let dblOn = false
  dbl?.addEventListener('click', ()=>{
    dblOn = !dblOn; viewer.setDoubleSide(dblOn); dbl.textContent = `DoubleSide: ${dblOn?'on':'off'}`
  })

  // View
  document.getElementById('bgDark')?.addEventListener('click', ()=> document.body.style.background='#0e0f13')
  document.getElementById('bgLight')?.addEventListener('click', ()=> document.body.style.background='#eaeef5')
}
