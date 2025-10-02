// pins.js
import store from './store.js';

if (!store.state.pins) {
  store.set({ pins: [] });
}

// 既存の addPinAt などの処理がここにある想定
