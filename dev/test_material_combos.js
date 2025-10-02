// dev/test_material_combos.js — run from DevTools console: `LMY_testAllCombos()`
export function LMY_testAllCombos() {
  const qs = (s)=>document.querySelector(s);
  const el = {
    unlit: qs('#mat-unlit'),
    ds: qs('#mat-doubleside'),
    w2a: qs('#mat-w2a'),
    th: qs('#mat-th'),
    op: qs('#mat-o')
  };
  const click = (c)=>{ c.click(); c.dispatchEvent(new Event('input', {bubbles:true})); };
  const setRange = (r,v)=>{ r.value=v; r.dispatchEvent(new Event('input',{bubbles:true})); };

  const combos = [];
  for (const U of [0,1]) for (const D of [0,1]) for (const W of [0,1]) for (const O of [1,0]) {
    combos.push({U,D,W,O});
  }

  (async () => {
    for (const [i,c] of combos.entries()) {
      // reset baseline
      if (el.unlit.checked) click(el.unlit);
      if (el.w2a.checked) click(el.w2a);
      if (el.ds.checked) click(el.ds);
      setRange(el.op, 1);
      await new Promise(r=>setTimeout(r,60));

      if (c.U) click(el.unlit);
      if (c.D) click(el.ds);
      if (c.W) { click(el.w2a); setRange(el.th, 0.98); }
      setRange(el.op, c.O ? 1 : 0.5);
      await new Promise(r=>setTimeout(r,80));
      console.log(`[combo ${i+1}/16]`, c, '✓');
    }
  })();
}
