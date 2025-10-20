/* LM Materials Sheets rate-limit patch (A-series)
   - Wraps window.fetch to coalesce/throttle Google Sheets write calls (PUT/POST)
   - Prevents bursts from sliders causing 429 RESOURCE_EXHAUSTED
   - Safe no-op for non-Sheets requests
   - Logs under [lm-patch]
*/
(function(){
  if (window.__LM_PATCH && window.__LM_PATCH.version === "LM-PATCH-A7") return;
  const log = (...a)=>console.log("[lm-patch]", ...a);
  window.__LM_PATCH = { version: "LM-PATCH-A7" };
  try{
    const origFetch = window.fetch.bind(window);
    const isSheetsUrl = (url)=>{
      try{ const u = (typeof url==="string")? new URL(url): new URL(url.url||"", location.href);
           return u.host.endsWith("sheets.googleapis.com"); }catch(e){ return false; }
    };
    const isWrite = (method, url)=>{
      const m = String(method||"GET").toUpperCase();
      if(m!=="POST" && m!=="PUT") return false;
      try{
        const u = new URL(typeof url==="string"? url : (url.url||""), location.href);
        return u.pathname.includes("/values/") || u.pathname.endsWith(":batchUpdate");
      }catch(e){ return false; }
    };

    const queue = [];
    let busy = false;
    let timer = null;
    const MIN_GAP_MS = 350;  // spacing between writes
    const RETRY_BASE = 900;  // initial retry gap on 429
    const MAX_RETRY = 6;

    const keyOf = (input, init)=>{
      const method = (init && init.method) || (input && input.method) || "GET";
      let rawUrl = typeof input==="string" ? input : (input && input.url) || "";
      try{ const u = new URL(rawUrl, location.href);
           const sp = [...u.searchParams.entries()].sort();
           const search = sp.map(([k,v])=>`${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
           rawUrl = `${u.origin}${u.pathname}${search?("?"+search):""}`;
      }catch(e){}
      return method + " " + rawUrl;
    };

    const enqueue = (input, init)=>{
      const k = keyOf(input, init);
      const body = init && init.body;
      const idx = queue.findIndex(it=> it.key===k && !it.inflight);
      if(idx>=0){
        queue[idx].input = input;
        queue[idx].init = init;
        queue[idx].body = body;
        queue[idx].ts = Date.now();
        return queue[idx].promise;
      }
      let resolve, reject;
      const promise = new Promise((res, rej)=> (resolve=res, reject=rej));
      queue.push({ key:k, input, init, body, resolve, reject, retries:0, inflight:false, ts:Date.now() });
      pump();
      return promise;
    };

    const pump = ()=>{
      if (busy) return;
      const nextIdx = queue.findIndex(it=> !it.inflight);
      if (nextIdx<0) return;
      const it = queue[nextIdx];
      busy = true; it.inflight = true;
      const init = Object.assign({}, it.init||{});
      if (typeof it.body !== "undefined") init.body = it.body;
      origFetch(it.input, init).then(async resp=>{
        if(resp.status===429){
          it.inflight=false; busy=false;
          it.retries = (it.retries||0)+1;
          const wait = Math.min(RETRY_BASE * Math.pow(1.7, it.retries-1), 8000);
          if (it.retries<=MAX_RETRY){
            log("rate-limited, retry in", wait, "ms", it.key);
            clearTimeout(timer);
            timer = setTimeout(()=> pump(), wait);
          }else{
            it.reject(new Error("Rate limit exceeded after retries"));
            queue.splice(nextIdx,1);
            timer = setTimeout(()=>{ busy=false; pump(); }, MIN_GAP_MS);
          }
          return;
        }
        it.resolve(resp);
        queue.splice(nextIdx,1);
        busy=false;
        clearTimeout(timer);
        timer = setTimeout(()=> pump(), MIN_GAP_MS);
      }).catch(err=>{
        it.reject(err);
        queue.splice(nextIdx,1);
        busy=false;
        clearTimeout(timer);
        timer = setTimeout(()=> pump(), MIN_GAP_MS);
      });
    };

    window.fetch = function(input, init){
      const method = (init && init.method) || (input && input.method) || "GET";
      const isSheet = isSheetsUrl(typeof input==="string" ? input : (input && input.url));
      if (isSheet && isWrite(method, input)){
        return enqueue(input, init||{});
      }
      return origFetch(input, init);
    };

    log("rate-limit wrapper installed");
  }catch(e){
    console.warn("[lm-patch] failed to install", e);
  }
})();