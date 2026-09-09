// network-interceptor.js — injected into the MAIN world (the page's own
// JS context, not the isolated content-script world) at document_start,
// i.e. before Facebook's own bundle runs. Patches window.fetch and
// XMLHttpRequest so every request to Facebook's GraphQL endpoint has its
// raw response text handed off to content.js (isolated world) via
// postMessage — content.js can't see the page's own fetch/XHR calls
// directly, this bridge is the only way across that boundary.
//
// Passive only: every patched call still returns/behaves exactly as the
// original would. This never blocks, modifies, or delays a real request
// — it only reads a clone of the response after the fact.
(() => {
  if (window.__fbbdayNetworkPatched) return;
  window.__fbbdayNetworkPatched = true;

  const GRAPHQL_URL_RE = /\/api\/graphql\//;

  function postCapture(text) {
    if (!text) return;
    window.postMessage({ source: 'fbbday-network', text }, window.location.origin);
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const input = args[0];
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const result = origFetch.apply(this, args);
    if (GRAPHQL_URL_RE.test(url)) {
      result.then((res) => {
        res
          .clone()
          .text()
          .then(postCapture)
          .catch(() => {});
      }).catch(() => {});
    }
    return result;
  };

  const XHRProto = window.XMLHttpRequest.prototype;
  const origOpen = XHRProto.open;
  const origSend = XHRProto.send;

  XHRProto.open = function (method, url, ...rest) {
    this.__fbbdayUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };

  XHRProto.send = function (...args) {
    if (GRAPHQL_URL_RE.test(this.__fbbdayUrl || '')) {
      this.addEventListener('load', () => {
        try {
          postCapture(this.responseText);
        } catch {
          // ignore — e.g. responseType isn't text
        }
      });
    }
    return origSend.apply(this, args);
  };
})();
