# Better Tabs

Manage browser tabs and keep site sessions alive.

[![Firefox Add-on](https://img.shields.io/amo/v/better-tabs1?label=Firefox%20Add-on)](https://addons.mozilla.org/firefox/addon/better-tabs1/)
[![Users](https://img.shields.io/amo/users/better-tabs1)](https://addons.mozilla.org/firefox/addon/better-tabs1/)
[![Rating](https://img.shields.io/amo/rating/better-tabs1)](https://addons.mozilla.org/firefox/addon/better-tabs1/reviews/)

<p align="center">
  <img src="extension/icon.svg" alt="Better Tabs" width="128">
</p>

<p align="center">
  <img src="assets/demo.gif" alt="Better Tabs closing duplicate tabs, grouping tabs by site and flagging a logged-out site" width="760">
</p>

## Features

- **Group** (Alt+Shift+G) - Group tabs by site
- **Sort** (Alt+Shift+S) - Order tabs by site and title
- **Dedupe** (Alt+Shift+D) - Close duplicate tabs, with Undo
- **Live Mode** - Sort, group and optionally dedupe automatically as you browse
- **Keepalive** - Stay logged in to chosen sites ([how it works](docs/how-it-works.md))
- **Logout Alerts** - Know when a site logs you out
- **Back up & Sync** - Site list syncs with Firefox and exports to JSON

## Install

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/better-tabs1/). If it helps you, a [review](https://addons.mozilla.org/firefox/addon/better-tabs1/reviews/) helps others find it.

### Local Development

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `extension/manifest.json`

## Tests

```bash
npm test
```
