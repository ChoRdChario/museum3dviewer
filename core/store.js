export const store = {
  state: {
    pins: [],
    selected: null,
    images: []
  },
  set(patch) { Object.assign(this.state, patch); }
};
