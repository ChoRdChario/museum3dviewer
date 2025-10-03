
// features/utils.js  (v6.6.4)
export function normalizeFileId(input){
  if (!input) return '';
  let s = String(input).trim();
  try{
    const u = new URL(s);
    const m1 = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (m1) return m1[1];
    const id = u.searchParams.get('id');
    if (id) return id;
  }catch(_){}
  const m2 = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m2) return m2[1];
  return s;
}

export function getParam(name){
  return new URLSearchParams(location.search).get(name) || '';
}
