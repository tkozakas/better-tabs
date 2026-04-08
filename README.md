# Better Tabs

Manage browser tabs and keep site sessions alive.

## Install

### Quick Install

```bash
./install.sh          # opens the Firefox Add-ons store
./install.sh -local   # prints instructions for loading the extension locally
```

### From Add-ons Store

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/424d726dc8bc4debbdfe/).

### Local Development

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Features

- **Group by Domain** — Organize tabs into groups by website
- **Ungroup All** — Remove all tab groups
- **Sort Alphabetically** — Sort tabs by URL
- **Close Duplicates** — Remove duplicate tabs
- **Session Keepalive** — Periodically ping protected sites to keep you logged in

## Tests

```bash
npm test
```
