/* LociMyu boot.esm.cdn.js (auth+glb minimal overlay) 2025-11-12
 * Goal: stable Google auth shim + GLB load wiring without touching existing modules.
 * - No syntax errors, no top-level await, broad try/catch guards.
 * - Non-invasive: only defines new globals if not already defined.
 */
(function(){
  "use strict";
  // ---------- tiny logger ----------
  var TAG = "[LM-boot.min]";
  function log(){ try{ console.log.apply(console, [TAG].concat([].slice.call(arguments))); }catch(_){ } }
  function warn(){ try{ console.warn.apply(console, [TAG].concat([].slice.call(arguments))); }catch(_){ } }
  function err(){ try{ console.error.apply(console, [TAG].concat([].slice.call(arguments))); }catch(_){ } }

  // ---------- env/feature flags (optional) ----------
  var FLAGS = (window.__LM_FEATURES__ = window.__LM_FEATURES__ || {});
  if (typeof FLAGS.authShim === "undefined") FLAGS.authShim = true;
  if (typeof FLAGS.glbLoadWire === "undefined") FLAGS.glbLoadWire = true;

  // ---------- util: parse query ----------
  function parseQuery(){
    var out = {};
    try{
      var q = (location.search||"").replace(/^\?/, "");
      if (!q) return out;
      q.split("&").forEach(function(kv){
        if (!kv) return;
        var p = kv.split("=");
        var k = decodeURIComponent(p[0]||"");
        var v = decodeURIComponent((p[1]||"").replace(/\+/g,"%20"));
        if (k) out[k]=v;
      });
    }catch(_){}
    return out;
  }

  // ---------- GIS (Google Identity Services) auth shim ----------
  if (FLAGS.authShim){
    (function(){
      // quick config discovery
      var cfg = window.__LM_CONFIG__ = window.__LM_CONFIG__ || {};
      cfg.client_id = cfg.client_id || window.__LM_CLIENT_ID || (function(){
        try{
          var el = document.querySelector("[data-lm-client-id]");
          if (el && el.getAttribute) return el.getAttribute("data-lm-client-id");
        }catch(_){}
        var q = parseQuery();
        return q.client_id || "";
      })();
      cfg.scopes = cfg.scopes || [
        "https://www.googleapis.com/auth/spreadsheets",
        "https://www.googleapis.com/auth/drive.readonly"
      ];

      // state
      var token = null;
      var tokenExp = 0;
      var tokenClient = null;
      var loadingGIS = false;
      var loadedGIS = !!(window.google && window.google.accounts && window.google.accounts.oauth2);

      function nowSec(){ return Math.floor(Date.now()/1000); }

      function loadGIS(cb){
        if (loadedGIS) return cb();
        if (loadingGIS) { // poll until available
          var t = setInterval(function(){
            if (window.google && window.google.accounts && window.google.accounts.oauth2){
              clearInterval(t);
              loadedGIS = true;
              cb();
            }
          }, 100);
          return;
        }
        loadingGIS = true;
        var s = document.createElement("script");
        s.src = "https://accounts.google.com/gsi/client";
        s.async = true; s.defer = true;
        s.onload = function(){
          loadedGIS = true;
          cb();
        };
        s.onerror = function(){ warn("Failed to load GIS client"); cb(); };
        document.head.appendChild(s);
      }

      function ensureTokenClient(cb){
        loadGIS(function(){
          try{
            if (!window.google || !window.google.accounts || !window.google.accounts.oauth2){
              warn("GIS not available yet"); return cb(new Error("GIS not available"));
            }
            if (!tokenClient){
              tokenClient = window.google.accounts.oauth2.initTokenClient({
                client_id: cfg.client_id || "",
                scope: cfg.scopes.join(" "),
                callback: function(res){
                  try{
                    if (res && res.access_token){
                      token = res.access_token;
                      // expires_in is seconds from now
                      var exp = nowSec() + (Number(res.expires_in||0) | 0) - 30;
                      tokenExp = exp>0?exp:0;
                      log("token ok");
                    }else{
                      warn("token response without access_token", res);
                    }
                  }catch(e){ err("token callback", e); }
                }
              });
            }
            cb();
          }catch(e){ cb(e); }
        });
      }

      // public: getAccessToken
      window.__lm_getAccessToken = window.__lm_getAccessToken || function(cb){
        try{
          ensureTokenClient(function(initErr){
            if (initErr){ return cb(initErr); }
            var fresh = token && tokenExp && (tokenExp - nowSec() > 30);
            if (fresh){ return cb(null, token); }
            try{
              tokenClient.requestAccessToken({ prompt: "" });
              // Wait for callback to set token
              var tries = 0;
              var t = setInterval(function(){
                tries++;
                if (token){ clearInterval(t); return cb(null, token); }
                if (tries > 100){ // ~10s
                  clearInterval(t);
                  cb(new Error("timeout getting token"));
                }
              }, 100);
            }catch(e){
              cb(e);
            }
          });
        }catch(e){
          cb(e);
        }
      };

      // public: auth-fetch wrapper
      if (typeof window.__lm_fetchJSONAuth !== "function"){
        window.__lm_fetchJSONAuth = function(url, opt){
          opt = opt || {};
          var headers = opt.headers ? Object.assign({}, opt.headers) : {};
          function doFetch(bearer){
            if (bearer){
              headers.Authorization = "Bearer " + bearer;
            }
            var fOpt = Object.assign({}, opt, { headers: headers });
            return fetch(url, fOpt).then(function(r){
              if (!r.ok){
                var e = new Error("HTTP "+r.status);
                e.status = r.status;
                e.response = r;
                throw e;
              }
              var ct = r.headers.get("content-type")||"";
              if (ct.indexOf("application/json")>=0) return r.json();
              return r.text();
            });
          }
          return new Promise(function(resolve, reject){
            window.__lm_getAccessToken(function(err, tok){
              if (err){ return reject(err); }
              doFetch(tok).then(resolve).catch(function(e){
                // one 401 retry
                if (e && (e.status===401 || e.status===403)){
                  token = null; tokenExp = 0;
                  window.__lm_getAccessToken(function(err2, tok2){
                    if (err2) return reject(err2);
                    doFetch(tok2).then(resolve).catch(reject);
                  });
                }else{
                  reject(e);
                }
              });
            });
          });
        };
      }

      // wire sign-in button if present
      function wireSignin(){
        try{
          var btn = document.getElementById("auth-signin");
          if (!btn) return;
          if (btn.__lm_wired__) return;
          btn.__lm_wired__ = true;
          btn.addEventListener("click", function(){
            window.__lm_getAccessToken(function(e){
              if (e){ return warn("signin failed:", e&&e.message); }
              log("signin ok");
            });
          });
        }catch(e){ warn("wireSignin", e); }
      }
      if (document.readyState === "loading"){
        document.addEventListener("DOMContentLoaded", wireSignin, { once: true });
      }else{
        wireSignin();
      }
      log("auth shim ready");
    })();
  }

  // ---------- GLB load wiring ----------
  if (FLAGS.glbLoadWire){
    (function(){
      function dispatchLoad(url){
        try{
          if (!url) return;
          var ev = new CustomEvent("lm:load-glb", { detail: { url: String(url) } });
          window.dispatchEvent(ev);
          log("lm:load-glb dispatched", url);
        }catch(e){ warn("dispatchLoad", e); }
      }

      function wireGLB(){
        try{
          var input = document.getElementById("glbUrl");
          var btn = document.getElementById("btnGlb");
          if (btn && !btn.__lm_wired__){
            btn.__lm_wired__ = true;
            btn.addEventListener("click", function(){
              var url = (input && input.value) || "";
              dispatchLoad(url);
            });
          }
          // auto from query ?glb=
          var q = parseQuery();
          if (q.glb){ dispatchLoad(q.glb); }
        }catch(e){ warn("wireGLB", e); }
      }

      if (document.readyState === "loading"){
        document.addEventListener("DOMContentLoaded", wireGLB, { once: true });
      }else{
        wireGLB();
      }
      log("glb wire ready");
    })();
  }
})();