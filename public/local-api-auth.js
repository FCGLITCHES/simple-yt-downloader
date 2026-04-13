(function () {
  let cachedServerTokenPromise = null;

  function getServerToken() {
    if (!window.electronAPI || typeof window.electronAPI.getServerToken !== "function") {
      return Promise.resolve(null);
    }

    if (!cachedServerTokenPromise) {
      cachedServerTokenPromise = window.electronAPI
        .getServerToken()
        .catch(function () {
          return null;
        });
    }

    return cachedServerTokenPromise;
  }

  function mergeHeaders(baseHeaders, token) {
    var headers = new Headers(baseHeaders || {});
    if (token) {
      headers.set("X-Server-Token", token);
    }
    return headers;
  }

  async function authorizedFetch(input, init) {
    var token = await getServerToken();
    var nextInit = Object.assign({}, init || {});
    nextInit.headers = mergeHeaders(nextInit.headers, token);
    return fetch(input, nextInit);
  }

  async function buildWebSocketUrl(baseUrl) {
    var token = await getServerToken();
    if (!token) {
      return baseUrl;
    }

    var wsUrl = new URL(baseUrl);
    wsUrl.searchParams.set("token", token);
    return wsUrl.toString();
  }

  window.localApiAuth = {
    authorizedFetch: authorizedFetch,
    buildWebSocketUrl: buildWebSocketUrl,
    getServerToken: getServerToken,
    mergeHeaders: mergeHeaders,
  };
})();
