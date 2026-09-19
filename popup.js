const grabBtn = document.getElementById("grab");
const preview = document.getElementById("preview");
const status = document.getElementById("status");
const updateBtn = document.getElementById("update");
const resetBtn = document.getElementById("resetConfig");
const configStatus = document.getElementById("configStatus");
const logBox = document.getElementById("log");

// Same mechanism as the "Isi Form IGD" consent-filler extension's template
// update: a small JSON file on GitHub, fetched on demand and cached in
// chrome.storage.local, so a broken selector on the HINTS side (or a fix to
// the identity pattern) can ship without redistributing the .zip.
const CONFIG_URL =
  "https://raw.githubusercontent.com/p3llucid3/oplosan-obat-extension/main/config.json";

function setStatus(text, kind) {
  status.textContent = text;
  status.className = kind || "";
}

function log(msg) {
  logBox.textContent += msg + "\n";
  logBox.scrollTop = logBox.scrollHeight;
}

function setConfigStatus(text, kind) {
  configStatus.textContent = text;
  configStatus.className = kind || "";
}

function showCachedConfigState() {
  chrome.storage.local.get(["hintsConfig"], (data) => {
    if (data && data.hintsConfig) {
      const v = data.hintsConfig.version ? ` (v${data.hintsConfig.version})` : "";
      setConfigStatus(`Memakai konfigurasi dari GitHub${v}.`);
    } else {
      setConfigStatus("Memakai konfigurasi bawaan (belum pernah diperbarui).");
    }
  });
}
showCachedConfigState();

updateBtn.addEventListener("click", async () => {
  setConfigStatus("Mengambil konfigurasi terbaru…");
  try {
    const res = await fetch(CONFIG_URL, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const json = await res.json();

    // Validate before storing anything — a malformed remote config must
    // never silently break extraction on every machine that updates.
    if (typeof json !== "object" || json === null) {
      throw new Error("Format konfigurasi tidak valid");
    }
    if (json.identityPattern) {
      const compiled = window.HintsExtract.compileRegex(json.identityPattern, json.identityFlags, null);
      if (!compiled) throw new Error("Pola identitas (identityPattern) tidak valid, tidak disimpan");
    }

    chrome.storage.local.set({ hintsConfig: json }, () => {
      log("✅ Konfigurasi diperbarui dari GitHub");
      showCachedConfigState();
    });
  } catch (err) {
    log("❌ Gagal memperbarui konfigurasi: " + err.message);
    setConfigStatus("Gagal memperbarui — memakai konfigurasi sebelumnya.", "error");
  }
});

resetBtn.addEventListener("click", () => {
  chrome.storage.local.remove(["hintsConfig"], () => {
    log("↩️ Kembali ke konfigurasi bawaan");
    showCachedConfigState();
  });
});

grabBtn.addEventListener("click", () => {
  setStatus("Membaca halaman…");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab || !tab.url || !tab.url.startsWith("http://172.18.0.247/")) {
      setStatus("Buka halaman HINTS RSEC dulu.", "error");
      return;
    }

    chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_PATIENT" }, (response) => {
      if (chrome.runtime.lastError) {
        setStatus(
          "Tidak bisa menghubungi halaman. Muat ulang halaman HINTS lalu coba lagi.",
          "error"
        );
        return;
      }
      if (!response || !response.ok) {
        setStatus("Gagal membaca data.", "error");
        return;
      }

      const result = response.result;
      const summary = window.HintsExtract.formatSummary(result);
      preview.textContent = summary;

      navigator.clipboard
        .writeText(summary)
        .then(() => {
          if (!result.primary) {
            setStatus("Disalin — tapi identitas pasien tidak ditemukan.", "warn");
          } else if (result.ambiguous) {
            setStatus(
              `Disalin — ${result.identities.length} pasien terdeteksi di halaman, memakai yang pertama (${result.primary.name}). Periksa kembali.`,
              "warn"
            );
          } else if (result.weight == null && result.height == null) {
            setStatus("Disalin — BB/TB belum terisi di HINTS.", "warn");
          } else {
            setStatus("Disalin ke clipboard ✔");
          }
        })
        .catch(() => {
          setStatus("Data dibaca tapi gagal menyalin ke clipboard.", "error");
        });
    });
  });
});
