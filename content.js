(() => {
  if (window.__HINTS_EXTRACT_V01__) return;
  window.__HINTS_EXTRACT_V01__ = true;

  // extract.js is loaded before this file (see manifest content_scripts order)
  // and attaches window.HintsExtract.
  const HintsExtract = window.HintsExtract;

  function log(msg) {
    console.log("[HINTS extract]", msg);
  }

  /**
   * Retry engine, same shape as the consent-filler extension: the vitals
   * fields aren't always present the instant the content script runs (Kendo
   * widgets render async), so poll briefly before giving up.
   */
  function tryExtract(config, attempt = 1) {
    const result = HintsExtract.extract(document, config);
    const hasAnything = result.weight != null || result.height != null || result.primary;

    if (!hasAnything && attempt <= 4) {
      log(`Belum ada data pasien terlihat, retry ${attempt}/4`);
      return new Promise((resolve) => {
        setTimeout(() => resolve(tryExtract(config, attempt + 1)), 300);
      });
    }

    return Promise.resolve(result);
  }

  /**
   * Config fetched from GitHub by the popup's "Perbarui" button and cached
   * here (see popup.js) — lets field IDs / the identity pattern be fixed if
   * HINTS changes its markup, without shipping a new .zip to every machine.
   * Absent or malformed config is a no-op; extract() falls back to defaults.
   */
  function getStoredConfig() {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(["hintsConfig"], (data) => {
          resolve((data && data.hintsConfig) || null);
        });
      } catch (e) {
        resolve(null);
      }
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type !== "EXTRACT_PATIENT") return;
    getStoredConfig().then((config) => tryExtract(config)).then((result) => {
      sendResponse({ ok: true, result });
    });
    return true; // keep the message channel open for the async response
  });
})();
