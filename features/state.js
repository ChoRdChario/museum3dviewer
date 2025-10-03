
// features/state.js  (v6.6.3)
export const bus = new EventTarget();

export function emit(type, detail = {}) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

const state = {
  authed: false,
  selectedPinId: null,
};

export function getState() { return { ...state }; }
export function setAuthed(v) {
  state.authed = !!v;
  emit('auth:change', { authed: state.authed });
}
export function setSelectedPin(id) {
  state.selectedPinId = id;
  emit('pin:selected', { id });
}
