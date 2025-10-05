// pins.js — minimal safe placeholders to avoid runtime errors
export function setupPins(app){
  // no-op placeholder; real pin system lives in a separate module in production.
  // This file intentionally exposes a compatible API so the rest of the app works.
  app.pins = {
    add(){ console.warn('[pins] placeholder add()'); },
    clear(){ console.warn('[pins] placeholder clear()'); }
  };
}
