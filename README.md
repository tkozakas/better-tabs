# Better Tabs

Manage browser tabs and keep site sessions alive.

<p align="center">
  <img src="extension/icon.svg" alt="Better Tabs" width="128">
</p>

<p align="center">
  <img src="assets/preview.png" alt="Better Tabs popup" width="340">
</p>

## Features

- **Group by Domain** (Alt+Shift+G) - Organize tabs into groups by website, optionally merging subdomains; single tabs stay ungrouped
- **Ungroup All** - Remove all tab groups
- **Sort** (Alt+Shift+S) - Sort tabs by site and title; groups stay intact on top, loose tabs sorted below
- **Close Duplicates** (Alt+Shift+D) - Remove duplicate tabs with one-click undo that restores exactly the tabs closed; can ignore query strings, never closes pinned or audible tabs
- **Live Mode** - Automatically closes duplicate tabs as you browse, with **Auto sort** and **Auto group** sub-options; never moves your current tab
- **Session Keepalive** - Ping protected sites in the background so you stay logged in, with per-site ping intervals and URLs; permission is requested per site, never for all websites ([how it works](docs/how-it-works.md))
- **Logout Alerts** - The badge shows a red `!` when a site may have logged you out, and you get notified when a ping fails or lands on a login page
- **Back up / Restore** - Export the protected site list to JSON or import it in another browser
- **Sync** - The site list follows your Firefox account; ping status stays on each computer

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
