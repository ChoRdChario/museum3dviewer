// LociMyu - share.fetch.guard.js
// Safety net only. In the new policy, Share safety is primarily guaranteed by not loading write-capable modules.

(function(){
  const isShare = !!(window.__lm_isShareMode && window.__lm_isShareMode());
  if (!isShare) return;

  const TAG = '[lm-share-guard]';
  const ALLOW_METHODS = new Set(['GET','HEAD','OPTIONS']);
  const BLOCK_DOMAINS = [
    'https://sheets.googleapis.com/',
    'https://www.googleapis.com/sheets/',
    'https://drive.googleapis.com/',
    'https://www.googleapis.com/drive/'
  ];

  const origFetch = window.fetch.bind(window);

  window.fetch = function(input, init){
    try {
      const url = (typeof input === 'string') ? input : (input && input.url) ? input.url : String(input);
      const method = (init && init.method ? String(init.method) : (input && input.method ? String(input.method) : 'GET')).toUpperCase();

      const isGoogleApi = BLOCK_DOMAINS.some(prefix => url.startsWith(prefix));
      if (isGoogleApi && !ALLOW_METHODS.has(method)) {
        console.warn(TAG, 'blocked non-GET request in Share mode:', method, url);
        // Return a synthetic "blocked" response to avoid hard crashes.
        return Promise.resolve(new Response(JSON.stringify({ blocked:true, mode:'share', method, url }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' }
        }));
      }
    } catch(e) {
      // If guard logic fails, do not block fetch. We don't want false positives here.
      console.warn(TAG, 'guard error (ignored)', e);
    }
    return origFetch(input, init);
  };

  console.log(TAG, 'armed');
})();
