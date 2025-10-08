console.log('[safe-loader] start');
(async () => {
  try {
    const mod = await import('./app_boot.js');
    console.log('[safe-loader] app_boot imported', Object.keys(mod || {}));
    if (mod && typeof mod.boot === 'function') {
      await mod.boot();
      console.log('[safe-loader] boot() done');
    }
  } catch (e) {
    console.error('[safe-loader] app_boot failed during import/boot', e);
  }
})();
