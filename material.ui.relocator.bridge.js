// minimal relocator: remove any stray material controls under the tab button
(function(){
  if (window.__lm_relocator_installed) return;
  window.__lm_relocator_installed = true;
  const tab = document.getElementById('tab-material');
  if (tab) {
    tab.querySelectorAll('#materialSelect,#opacityRange,select,input[type="range"]').forEach(n=>n.remove());
  }
})();