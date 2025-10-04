// ESM proxy to Three.js via CDN (no default export in upstream)
import * as THREE_NS from 'https://unpkg.com/three@0.160.0/build/three.module.js';
export * from 'https://unpkg.com/three@0.160.0/build/three.module.js';
export default THREE_NS;
