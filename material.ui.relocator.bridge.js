/**
 * material.ui.relocator.bridge.js — Remove leftovers under tab button
 * - Delete accidental UI nodes placed inside #tab-material.
 * - Do not create or move anything.
 * - Runs once after DOM ready.
 */
(() => {
  const TAG = "[mat-ui-clean:min]";
  const log = (...a)=>console.log(TAG, ...a);

  const run = () => {
    const tabBtn = document.getElementById("tab-material");
    if (!tabBtn) return;
    const killers = tabBtn.querySelectorAll("#materialSelect, #opacityRange, select[name='materialSelect']");
    let n = 0;
    killers.forEach(nod => { nod.remove(); n++; });
    if (n) log("removed rogue UI under tab button:", n);
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  } else {
    run();
  }
})();