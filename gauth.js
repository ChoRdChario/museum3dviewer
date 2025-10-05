export async function setupAuth(){
  const chip = document.getElementById('authChip')
  let signed = false
  function render(){
    if (!chip) return
    chip.textContent = signed ? 'Signed in' : 'Sign in'
    chip.dataset.state = signed ? 'in' : 'out'
  }
  render()
  chip?.addEventListener('click', ()=>{
    signed = !signed
    render()
    const ev = new CustomEvent(signed ? 'auth:signed-in' : 'auth:signed-out', {detail:{signed}})
    window.dispatchEvent(ev)
  })
}
