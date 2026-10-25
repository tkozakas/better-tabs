# Better Tabs

Manage browser tabs and keep site sessions alive.

<p align="center">
  <img src="extension/icon.svg" alt="Better Tabs" width="128">
</p>

<p align="center">
  <img src="assets/preview.png" alt="Better Tabs popup" width="340">
</p>

## Features

- **Group** (Alt+Shift+G) - Group tabs by site
- **Sort** (Alt+Shift+S) - Order tabs by site and title
- **Dedupe** (Alt+Shift+D) - Close duplicate tabs, with Undo
- **Live Mode** - Dedupe, sort and group automatically as you browse
- **Keepalive** - Stay logged in to chosen sites ([how it works](docs/how-it-works.md))
- **Logout Alerts** - Know when a site logs you out
- **Back up & Sync** - Site list syncs with Firefox and exports to JSON

## Install

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/better-tabs1/).

### Local Development

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Tests

```bash
npm test
```
