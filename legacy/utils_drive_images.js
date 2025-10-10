// utils_drive_images.js (stub for local dev)
// Provides a helper used by pins.js to fetch an image blob from a Drive url/id.
// We just return a tiny transparent PNG so calls succeed without Drive.

// 1x1 transparent PNG
const TRANSPARENT_BASE64 = 
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=';

export async function downloadImageAsBlob(_driveFileIdOrUrl){
  const binary = atob(TRANSPARENT_BASE64);
  const len = binary.length;
  const buf = new Uint8Array(len);
  for (let i=0;i<len;i++) buf[i] = binary.charCodeAt(i);
  return new Blob([buf], {type: 'image/png'});
}
