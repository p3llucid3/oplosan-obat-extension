/**
 * extract.js — shared extraction logic for the HINTS RSEC autofill extension.
 *
 * Written to run in two environments unmodified:
 *   1. As a browser content script (attaches to `window.HintsExtract`).
 *   2. As a CommonJS module under Node/jsdom for unit tests
 *      (`module.exports = HintsExtract`).
 *
 * No DOM API is assumed beyond what jsdom also provides (querySelector,
 * innerText/textContent, closest), so the same code path is what ships.
 */
(function (root) {
  "use strict";

  var WEIGHT_ID = "igd_periksa_berat";
  var HEIGHT_ID = "igd_periksa_tinggi";

  // Matches one patient-identity block, e.g.:
  // "Sdr. FIZA NUR DIONO RM: 007774, Laki-laki, 27Y 00M 00D Alamat: DAMTELU
  //  (JL. RUNGKUT MENANGGAL 2 NO.04) e-Resep Token (208847) Hijau"
  // Captures are intentionally loose — HINTS's own formatting is not fully
  // consistent — and every capture group past title/name/rm is optional.
  var IDENTITY_RE =
    /(Sdr\.|Ny\.|Tn\.|An\.)\s+([A-Za-z][A-Za-z.'\- ]*?)\s+RM\s*:\s*(\d+)(?:\s*,\s*(Laki-laki|Perempuan))?(?:\s*,?\s*(\d+\s*Y\s*\d+\s*M\s*\d+\s*D))?(?:\s*Alamat\s*:\s*(.*?))?(?=\s*(?:Sdr\.|Ny\.|Tn\.|An\.|$))/gs;

  /**
   * Turn a remotely-supplied {pattern, flags} into a working RegExp, falling
   * back to `fallback` on any error — a malformed remote config must never
   * crash extraction, only silently decline to apply.
   */
  function compileRegex(pattern, flags, fallback) {
    if (!pattern) return fallback;
    try {
      var re = new RegExp(pattern, flags || "gs");
      // A regex without the global flag would make findIdentities loop
      // forever (re.exec never advances lastIndex on its own), so refuse it.
      if (re.flags.indexOf("g") === -1) return fallback;
      return re;
    } catch (e) {
      return fallback;
    }
  }

  function normalizeWhitespace(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  /** innerText if available (real browser), else textContent (jsdom often lacks layout-based innerText). */
  function textOf(el) {
    if (!el) return "";
    if (typeof el.innerText === "string" && el.innerText.length) return el.innerText;
    return el.textContent || "";
  }

  /**
   * Find every RM-style identity block within a chunk of text.
   * Returns [] if none found. Never throws on malformed input.
   */
  function findIdentities(text, regex) {
    var out = [];
    if (!text) return out;
    var base = regex || IDENTITY_RE;
    var re = new RegExp(base.source, base.flags);
    var m;
    while ((m = re.exec(text)) !== null) {
      var rm = m[3];
      // Guard against a blank/placeholder RM (e.g. "RM: " with no digits, or
      // an all-zero RM used as a not-yet-assigned placeholder in some views).
      if (!rm || /^0+$/.test(rm)) continue;
      // Address has no reliable closing delimiter in the source text (it can
      // run all the way to end-of-string when only one identity is on the
      // page), so cap it defensively rather than trust it to stay in bounds.
      var address = m[6] ? normalizeWhitespace(m[6]) : null;
      if (address) {
        address = address.split(/\n/)[0];
        if (address.length > 120) address = address.slice(0, 120) + "…";
      }
      out.push({
        title: m[1],
        name: normalizeWhitespace(m[2]),
        rm: rm,
        gender: m[4] || null,
        age: m[5] ? normalizeWhitespace(m[5]) : null,
        address: address,
        raw: normalizeWhitespace(m[0]).slice(0, 200)
      });
      // Prevent zero-length-match infinite loops on pathological input.
      if (re.lastIndex === m.index) re.lastIndex++;
    }
    return out;
  }

  /**
   * Locate the identity block most likely to belong to the currently open
   * patient, given a Document (or Document-like) `doc`.
   *
   * Strategy, narrowest scope first:
   *   1. #pasiencol (persistent patient-info panel, per nurse recording).
   *   2. The nearest ancestor container of the weight input, walking up a
   *      few levels — covers a patient popup/panel that isn't #pasiencol.
   *   3. The whole page.
   * Returns { identities, primary, ambiguous, scope }.
   */
  function locateIdentity(doc, opts) {
    var regex = (opts && opts.identityRegex) || IDENTITY_RE;
    var weightId = (opts && opts.weightId) || WEIGHT_ID;
    var candidates = [];
    var scope = "document";

    var panel = doc.querySelector && doc.querySelector("#pasiencol");
    if (panel) {
      candidates = findIdentities(textOf(panel), regex);
      if (candidates.length) scope = "#pasiencol";
    }

    if (!candidates.length) {
      var weightInput = doc.getElementById && doc.getElementById(weightId);
      var el = weightInput;
      for (var depth = 0; el && depth < 6 && !candidates.length; depth++) {
        var found = findIdentities(textOf(el), regex);
        if (found.length) {
          candidates = found;
          scope = "ancestor(" + depth + ")";
        }
        el = el.parentElement;
      }
    }

    if (!candidates.length) {
      var bodyText = textOf(doc.body || doc.documentElement);
      candidates = findIdentities(bodyText, regex);
      scope = "document";
    }

    return {
      identities: candidates,
      primary: candidates.length ? candidates[0] : null,
      ambiguous: candidates.length > 1,
      scope: scope
    };
  }

  function readNumericField(doc, id) {
    var el = doc.getElementById && doc.getElementById(id);
    if (!el) return null;
    var raw = (el.value != null ? el.value : textOf(el)).toString().trim();
    if (!raw) return null;
    // HINTS/Kendo numeric inputs may use "," as a decimal separator.
    var normalized = raw.replace(",", ".");
    var num = parseFloat(normalized);
    return isNaN(num) ? null : num;
  }

  /**
   * Top-level entry point. Returns a plain object describing everything
   * found on the page right now; never throws.
   *
   * `config` is an optional plain object — typically the JSON fetched from
   * GitHub and cached in chrome.storage.local (see popup.js) — that can
   * override field IDs and the identity pattern without shipping a new
   * version of the extension. Any field left out, or that fails to compile,
   * falls back to the built-in default silently.
   */
  function extract(doc, config) {
    doc = doc || (typeof document !== "undefined" ? document : null);
    if (!doc) {
      return { weight: null, height: null, identities: [], primary: null, ambiguous: false, scope: null };
    }

    var weightId = (config && config.weightId) || WEIGHT_ID;
    var heightId = (config && config.heightId) || HEIGHT_ID;
    var identityRegex = compileRegex(
      config && config.identityPattern,
      config && config.identityFlags,
      IDENTITY_RE
    );

    var weight = readNumericField(doc, weightId);
    var height = readNumericField(doc, heightId);
    var idResult = locateIdentity(doc, { identityRegex: identityRegex, weightId: weightId });

    return {
      weight: weight,
      height: height,
      identities: idResult.identities,
      primary: idResult.primary,
      ambiguous: idResult.ambiguous,
      scope: idResult.scope
    };
  }

  /**
   * Format the extracted result as paste-ready text for the clipboard.
   * Blank fields are shown as "-" rather than omitted, so a partial capture
   * is still obviously a template the user can hand-fix in the calculator.
   */
  function formatSummary(result) {
    var p = result.primary;
    var lines = [
      "Nama: " + (p ? p.title + " " + p.name : "-"),
      "RM: " + (p ? p.rm : "-"),
      "JK: " + (p && p.gender ? p.gender : "-"),
      "Usia: " + (p && p.age ? p.age : "-"),
      "BB: " + (result.weight != null ? result.weight + " kg" : "-"),
      "TB: " + (result.height != null ? result.height + " cm" : "-")
    ];
    return lines.join("\n");
  }

  var HintsExtract = {
    WEIGHT_ID: WEIGHT_ID,
    HEIGHT_ID: HEIGHT_ID,
    IDENTITY_RE: IDENTITY_RE,
    compileRegex: compileRegex,
    findIdentities: findIdentities,
    locateIdentity: locateIdentity,
    readNumericField: readNumericField,
    extract: extract,
    formatSummary: formatSummary
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = HintsExtract;
  } else {
    root.HintsExtract = HintsExtract;
  }
})(typeof window !== "undefined" ? window : this);
