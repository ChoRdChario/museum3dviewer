export const store = {
  state: { pins: [], selected: null, images: [] },
  set(part){ Object.assign(this.state, part); },
  get(){ return this.state; }
};