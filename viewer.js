// Minimal viewer shell — exports ensureViewer and safe helpers
// NOTE: Assumes three.module.js is already bundled elsewhere in your project.
// This stub focuses on sizing & API presence to prevent crashes during wiring.

export function ensureViewer({ canvas, host }) {
  if (!canvas || !host) throw new Error('[viewer] canvas/host missing');

  const api = {
    canvas,
    host,
    // required by pins.js integrations (no-op stubs to avoid crashes)
    raycastFromClientXY: (_x, _y) => null,
    addPinAtCenter: () => ({ id: Date.now().toString() }),
    setColor: (hex) => console.debug('[viewer] color set', hex),
  };

  // Handle resize
  const resize = () => {
    try {
      const w = host.clientWidth, h = host.clientHeight;
      canvas.width = w; canvas.height = h;
      canvas.style.width = w+'px'; canvas.style.height = h+'px';
    } catch {}
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  console.debug('[viewer] ready');
  return api;
}
