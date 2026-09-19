"use strict";
/**
 * Extraction logic tests, run against saved HINTS mock pages.
 * Usage: node test/extract.test.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");
const HintsExtract = require("../extract.js");

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("FAIL: " + msg);
  }
}

function loadFixture(name) {
  const file = path.join(__dirname, "fixtures", name);
  const html = fs.readFileSync(file, "utf8");
  const dom = new JSDOM(html);
  return dom.window.document;
}

// --- doctor grid view -------------------------------------------------
{
  const doc = loadFixture("doctor-grid.html");
  const r = HintsExtract.extract(doc);
  assert(r.weight === 62.5, "doctor-grid: weight parsed (" + r.weight + ")");
  assert(r.height === 168, "doctor-grid: height parsed (" + r.height + ")");
  assert(!!r.primary, "doctor-grid: identity found");
  assert(r.primary && r.primary.name === "FIZA NUR DIONO", "doctor-grid: name correct (" + (r.primary && r.primary.name) + ")");
  assert(r.primary && r.primary.rm === "007774", "doctor-grid: RM correct (" + (r.primary && r.primary.rm) + ")");
  assert(r.primary && r.primary.gender === "Laki-laki", "doctor-grid: gender correct");
  assert(!r.ambiguous, "doctor-grid: not ambiguous");
}

// --- nurse panel view (#pasiencol) -------------------------------------
{
  const doc = loadFixture("nurse-panel.html");
  const r = HintsExtract.extract(doc);
  assert(r.weight === 58, "nurse-panel: weight parsed");
  assert(r.height === 155, "nurse-panel: height parsed");
  assert(!!r.primary, "nurse-panel: identity found");
  assert(r.primary && r.primary.name === "SITI ROHANI", "nurse-panel: name correct (" + (r.primary && r.primary.name) + ")");
  assert(r.primary && r.primary.rm === "118820", "nurse-panel: RM correct");
  assert(r.scope === "#pasiencol", "nurse-panel: scoped to #pasiencol (got " + r.scope + ")");
  assert(!r.ambiguous, "nurse-panel: not ambiguous");
}

// --- blank / placeholder RM --------------------------------------------
{
  const doc = loadFixture("blank-rm.html");
  const r = HintsExtract.extract(doc);
  assert(r.primary === null, "blank-rm: no identity resolved (placeholder RM rejected)");
  assert(r.weight === null, "blank-rm: weight is null, not NaN or crash");
  assert(r.height === null, "blank-rm: height is null, not NaN or crash");
  const summary = HintsExtract.formatSummary(r);
  assert(summary.indexOf("Nama: -") !== -1, "blank-rm: summary shows placeholder dashes, not throwing");
}

// --- multiple patients visible at once ---------------------------------
{
  const doc = loadFixture("multi-patient.html");
  const r = HintsExtract.extract(doc);
  assert(r.identities.length === 2, "multi-patient: both identities found (" + r.identities.length + ")");
  assert(r.ambiguous === true, "multi-patient: flagged ambiguous");
  assert(r.primary && r.primary.name === "FIZA NUR DIONO", "multi-patient: first match used as primary");
  assert(r.weight === 70 && r.height === 172, "multi-patient: vitals still read correctly");
}

// --- formatSummary shape sanity -----------------------------------------
{
  const doc = loadFixture("doctor-grid.html");
  const r = HintsExtract.extract(doc);
  const summary = HintsExtract.formatSummary(r);
  assert(summary.split("\n").length === 6, "formatSummary: six lines");
  assert(summary.indexOf("BB: 62.5 kg") !== -1, "formatSummary: weight line formatted");
  assert(summary.indexOf("TB: 168 cm") !== -1, "formatSummary: height line formatted");
}

// --- remote config override (the "update from GitHub" mechanism) -------
{
  const doc = loadFixture("doctor-grid.html");

  // A config that only renames the field IDs (simulating a HINTS markup
  // change fixed via a GitHub config update, no new .zip needed).
  const renamed = fs.readFileSync(path.join(__dirname, "fixtures", "doctor-grid.html"), "utf8")
    .replace(/igd_periksa_berat/g, "bb_field")
    .replace(/igd_periksa_tinggi/g, "tb_field");
  const renamedDoc = new JSDOM(renamed).window.document;
  const configuredResult = HintsExtract.extract(renamedDoc, { weightId: "bb_field", heightId: "tb_field" });
  assert(configuredResult.weight === 62.5, "config override: renamed weight field still read");
  assert(configuredResult.height === 168, "config override: renamed height field still read");

  // A malformed remote pattern must fall back to the default, not crash.
  const badConfig = { identityPattern: "(unterminated", identityFlags: "gs" };
  const fallbackResult = HintsExtract.extract(doc, badConfig);
  assert(!!fallbackResult.primary, "config override: invalid identityPattern falls back to default rather than breaking extraction");

  // compileRegex itself: rejects a pattern missing the "g" flag (would hang findIdentities).
  const noGlobal = HintsExtract.compileRegex("RM:\\s*(\\d+)", "s", HintsExtract.IDENTITY_RE);
  assert(noGlobal === HintsExtract.IDENTITY_RE, "compileRegex: rejects a non-global pattern, falls back");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
