const statusEl = document.getElementById("status");
const fileInput = document.getElementById("import-file");
const dropZone = document.getElementById("drop-zone");

function setStatus(text, ok) {
  statusEl.textContent = text;
  statusEl.className = `status ${ok ? "ok" : "error"}`;
}

async function importFile(file) {
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) {
      setStatus("Invalid file: expected a JSON array of sites.", false);
      return;
    }
    const before = (await browser.runtime.sendMessage({ type: "getSites" })).length;
    const sites = await browser.runtime.sendMessage({ type: "importSites", sites: parsed });
    const added = sites.length - before;
    setStatus(`Imported ${added} new site${added === 1 ? "" : "s"} (${sites.length} total).`, true);
  } catch {
    setStatus("Could not read file: not valid JSON.", false);
  }
}

document.getElementById("export-btn").addEventListener("click", async () => {
  const sites = await browser.runtime.sendMessage({ type: "getSites" });
  const exported = (sites || []).map(({ domain, url, enabled, interval }) => ({ domain, url, enabled, interval }));
  const blob = new Blob([JSON.stringify(exported, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "better-tabs-sites.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  setStatus(`Exported ${exported.length} site${exported.length === 1 ? "" : "s"}.`, true);
});

document.getElementById("pick-btn").addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  importFile(fileInput.files[0]);
  fileInput.value = "";
});

dropZone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropZone.classList.add("dragover");
});

dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));

dropZone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  importFile(e.dataTransfer.files[0]);
});
