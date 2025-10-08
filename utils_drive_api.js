
/** Parse Google Drive file id from URL or raw id */
export function parseDriveId(input) {
  if (!input) return null;
  const s = String(input).trim();
  // URL patterns
  const byId = s.match(/[-\w]{25,}/);
  if (s.startsWith("http")) {
    // Try common patterns: /d/<id>/, ?id=<id>, /file/d/<id>/
    const m = s.match(/(?:\/d\/|id=)([-\w]{25,})/);
    if (m) return m[1];
    if (byId) return byId[0];
    return null;
  }
  // Raw id
  return byId ? byId[0] : null;
}

export function buildDriveDownloadUrl(id) {
  return `https://www.googleapis.com/drive/v3/files/${id}?alt=media`;
}
