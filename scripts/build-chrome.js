const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "extension");
const DIST = path.join(ROOT, "dist");
const OUT = path.join(DIST, "chrome");
const ZIP = path.join(DIST, "better-tabs-chrome.zip");
const FIREFOX_ONLY = new Set(["manifest.json", "amo-metadata.json", ".amo-upload-uuid", "icon.svg", "web-ext-artifacts"]);
const SERVICE_WORKER = "service-worker.js";
const ICON = { 128: "icon.png" };

const isHostPattern = permission => permission === "<all_urls>" || permission.includes("://");

function chromeManifest(firefox) {
  const {
    manifest_version,
    browser_action,
    browser_specific_settings,
    optional_permissions = [],
    background,
    icons,
    ...shared
  } = firefox;
  const optionalApis = optional_permissions.filter(p => !isHostPattern(p));
  return {
    manifest_version: 3,
    minimum_chrome_version: "148",
    ...shared,
    ...(optionalApis.length > 0 && { optional_permissions: optionalApis }),
    optional_host_permissions: optional_permissions.filter(isHostPattern),
    background: { service_worker: SERVICE_WORKER },
    icons: ICON,
    action: { ...browser_action, default_icon: ICON }
  };
}

function build() {
  const firefox = JSON.parse(fs.readFileSync(path.join(SOURCE, "manifest.json"), "utf8"));
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.cpSync(SOURCE, OUT, { recursive: true, filter: src => !FIREFOX_ONLY.has(path.basename(src)) });
  const imports = firefox.background.scripts.map(s => JSON.stringify(s)).join(", ");
  fs.writeFileSync(path.join(OUT, SERVICE_WORKER), `importScripts(${imports});\n`);
  fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(chromeManifest(firefox), null, 2) + "\n");
  execFileSync("zip", ["-qr", ZIP, "."], { cwd: OUT });
  console.log(`Built ${path.relative(ROOT, OUT)} and ${path.relative(ROOT, ZIP)}`);
}

build();
