export const store = {
  state: {
    pins: [],       // {id, x,y,z, caption:{title,body,img}}
    selected: null, // pin id
    images: [],
    camera: { mode:'persp', ortho:{ v0: 1, zoom:1, aspect:1 } }
  },
  set(part){ Object.assign(this.state, part); },
  get(){ return this.state; }
};