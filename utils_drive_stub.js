// utils_drive_stub.js — replace with real drive.js later
export function normalizeDriveIdFromInput(s){
  if (!s) throw new Error('empty file id/url');
  const m = String(s).match(/[\w-]{20,}/);
  return m ? m[0] : s;
}
export async function fetchDriveFileAsArrayBuffer(id){
  if (id === 'demo') {
    const res = await fetch('https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Models/master/2.0/Duck/glTF-Binary/Duck.glb');
    if (!res.ok) throw new Error('failed to fetch demo glb');
    return await res.arrayBuffer();
  }
  const url = `https://drive.google.com/uc?export=download&id=${encodeURIComponent(id)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Drive public fetch failed (make sure shared)');
  const buf = await res.arrayBuffer();
  const head = new TextDecoder().decode(new Uint8Array(buf).slice(0, 128));
  if (/<!doctype|<html/i.test(head)) throw new Error('got HTML (not GLB). Check permissions or use gapi download');
  return buf;
}
