/*! drive.images.list.js — list sibling images in the same folder as a GLB fileId.
 *
 * - Uses auth.fetch.bridge.js (__lm_fetchJSONAuth) to call Drive v3.
 * - Filters for image files (jpeg/png/heic/heif).
 * - Returns a flat array of { id, name, mimeType, thumbnailUrl, url }.
 */
import ensureAuthBridge from './auth.fetch.bridge.js';

const DRIVE_ROOT = 'https://www.googleapis.com/drive/v3/files';

const IMAGE_MIME_WHITELIST = new Set([
  'image/jpeg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const IMAGE_EXT_WHITELIST = ['.jpg', '.jpeg', '.png', '.heic', '.heif'];

function looksLikeImage(file){
  const mt = (file && file.mimeType || '').toLowerCase();
  const name = (file && file.name || '').toLowerCase();

  if (IMAGE_MIME_WHITELIST.has(mt)) return true;

  if (mt.startsWith('image/')){
    if (IMAGE_EXT_WHITELIST.some(ext => name.endsWith(ext))) return true;
  }

  return false;
}

async function getJson(url, opts = {}){
  const fetchAuth = await ensureAuthBridge();
  return fetchAuth(url, opts);
}

/**
 * List sibling images in the same Drive folder as the given GLB fileId.
 * @param {string} fileId
 * @returns {Promise<Array<{id:string,name:string,mimeType:string,thumbnailUrl:string|null,url:string|null}>>}
 */
export async function listSiblingImagesByGlbId(fileId){
  if (!fileId) return [];
  try{
    // 1) Resolve parent folder
    const meta = await getJson(
      `${DRIVE_ROOT}/${encodeURIComponent(fileId)}?fields=id,name,parents`,
      {}
    );
    const parents = (meta && meta.parents) || [];
    const parentId = parents[0];
    if (!parentId) return [];

    // 2) List children of that folder (excluding trashed)
    const q = `'${parentId}' in parents and trashed = false`;
    const fields = 'files(id,name,mimeType,thumbnailLink,webViewLink,webContentLink),nextPageToken';

    let pageToken = undefined;
    const out = [];

    while (true){
      let url = `${DRIVE_ROOT}?q=${encodeURIComponent(q)}&spaces=drive&pageSize=1000&fields=${encodeURIComponent(fields)}`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

      const res = await getJson(url, {});
      const files = (res && res.files) || [];
      for (const f of files){
        if (!looksLikeImage(f)) continue;
        out.push({
          id: f.id,
          name: f.name,
          mimeType: f.mimeType || '',
          thumbnailUrl: f.thumbnailLink || null,
          url: f.webContentLink || f.webViewLink || null,
        });
      }
      pageToken = res && res.nextPageToken;
      if (!pageToken) break;
    }

    return out;
  }catch(e){
    console.warn('[drive.images.list] failed to list siblings', e);
    return [];
  }
}
