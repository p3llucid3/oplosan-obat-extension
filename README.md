# HINTS RSEC — Ambil Data Pasien

Chrome extension (MV3) that reads the currently-open patient's identity,
weight and height straight out of the HINTS RSEC EMR (`172.18.0.247`) and
copies a paste-ready summary to the clipboard, so it can be pasted into the
Kalkulator & Kitir (or, for now, the Google Sheet) instead of retyping.

Works for both the doctor and nurse navigation paths — both converge on the
same `#igd_periksa_berat` / `#igd_periksa_tinggi` fields.

## Install (unpacked, for testing)

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this folder.
3. Open a patient in HINTS RSEC (so the vitals panel/weight field is visible),
   click the extension icon, then **Ambil & salin**.

## What it does

- `extract.js` — all extraction logic, shared between the content script and
  the popup (loaded as a plain script in both, and as a CommonJS module in
  tests). No fixed grid IDs: identity is found by scanning visible text for
  the pattern `Sdr./Ny./Tn./An. <name> RM: <number>`, narrowed first to
  `#pasiencol` or the weight field's nearest container, and falling back to
  the whole page.
- `content.js` — retries the read a few times (300ms apart, matching the
  consent-filler extension's pattern) in case Kendo widgets haven't rendered
  yet, then answers the popup's `EXTRACT_PATIENT` message.
- `popup.html` / `popup.js` — one button, a preview of what will be copied,
  and a status line that flags when something looks off (no identity found,
  more than one candidate on the page, or BB/TB still empty).

## Updating from GitHub (without redistributing the .zip)

Same mechanism as the "Isi Form IGD" consent-filler extension's template
update — a small `config.json` in this repo, fetched on demand:

- Popup → **Perbarui dari GitHub** fetches
  `https://raw.githubusercontent.com/p3llucid3/oplosan-obat-extension/main/config.json`
  and caches it in `chrome.storage.local`. **Kembalikan ke default** clears
  the cache and reverts to the extension's built-in defaults.
- What it can override: `weightId` / `heightId` (if HINTS renames those input
  IDs) and `identityPattern` / `identityFlags` (if the identity text format
  changes). This is config, not code — it can't add new extraction logic or
  run arbitrary scripts, only re-point what's already there.
- A malformed `config.json` (bad JSON, or a regex that fails to compile, or
  one missing the `g` flag) is rejected before anything is stored — the
  popup shows an error and the previously-working config (or the built-in
  default) keeps being used. Nothing on the clinical-use side can be broken
  by a bad edit to this file; worst case is the update is simply refused.
- To ship a fix: edit `config.json` on `main` in this repo. Every install
  picks it up the next time someone clicks **Perbarui dari GitHub** — no
  re-zip, no reinstalling on every machine.

## Known limitation — carried over from the handover doc, confirmed in real use

The exact DOM location where patient identity redisplays *after* a patient
chart is opened wasn't confirmed from the DevTools recordings (they only
capture the click that opens a patient). The page-wide text scan is the
documented workaround. **Confirmed in real use on 20 Sep 2026**: on a real
HINTS RSEC page, the scan detected two patients (the open one, and a second
one — likely a previously-opened Kendo tab still present in the DOM even
though hidden) and would have auto-picked the wrong one.

**Fix shipped in v0.3.0**: when more than one patient is detected, the popup
no longer guesses — it shows every candidate (name + RM) and copies nothing
to the clipboard until the user clicks the correct one. This closes the
patient-safety gap (wrong RM/weight pasted into a dosing calculator) without
needing the DOM fix below; it does mean an extra click whenever HINTS shows
more than one patient's identity text on the page.

**Still open**: the *auto-detection* itself could be made smarter (so the
ambiguity prompt shows up less often) if someone can capture the live DOM
around the vitals panel while two patients are simultaneously present in it
— but that's a quality-of-life improvement now, not a safety gap, since the
picker makes a wrong guess impossible either way.

## Tests

`node test/extract.test.js` runs the extraction logic against saved mock
HTML fixtures under `test/fixtures/` (doctor grid view, nurse panel view, a
patient with a blank/placeholder RM, and a page with two patients visible at
once). No dependencies beyond Node + jsdom.

## Next steps (not built yet, see handover doc)

- The real web app for Kalkulator & Kitir isn't built yet — clipboard copy
  was chosen as the first deliverable because it works today with no
  dependency on that app existing.
- Once the web app exists, a second content script scoped to its own domain
  can read the same clipboard format (or receive it via URL params) and
  autofill directly.
