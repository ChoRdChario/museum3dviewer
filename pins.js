// Minimal pins overlay (keeps API surface; real logic can extend later)
export function setupPins(app){
  const overlay = document.getElementById('overlay');
  const img = document.getElementById('overlay-img');
  const ttl = document.getElementById('overlay-title');
  const body = document.getElementById('overlay-body');
  const leader = document.getElementById('leader');

  const ctx = leader.getContext('2d');
  let overlayPos = {x: 12, y: app?.host?.clientHeight-220 || 200 };

  function drawLeader(x1,y1,x2,y2,color='#e9c46a'){
    const c = leader;
    c.width = c.clientWidth; c.height = c.clientHeight;
    ctx.clearRect(0,0,c.width,c.height);
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
  }

  function showCaption({title, body:text, imgUrl, pinScreen}){
    overlay.style.display = 'block';
    ttl.textContent = title||'(untitled)';
    body.textContent = text||'';
    if (imgUrl){ img.src = imgUrl; img.style.display='block'; } else { img.removeAttribute('src'); img.style.display='none'; }
    const rect = overlay.getBoundingClientRect();
    const ox = rect.left + rect.width/2;
    const oy = rect.top + rect.height/2;
    if (pinScreen){
      drawLeader(ox, oy, pinScreen.x, pinScreen.y);
    }
  }

  function hideCaption(){
    overlay.style.display='none';
    const c = leader; ctx.clearRect(0,0,c.width,c.height);
  }

  return { showCaption, hideCaption };
}
