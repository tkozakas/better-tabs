## What's new in v3.2.0

- **Live mode is now "auto dedupe"** with two sub-options: **Auto sort** and **Auto group**. It never moves the tab you are currently on.
- **Keepalive asks permission per site.** The extension no longer needs access to all websites or cookies; Firefox prompts you when you protect a site.
- **Back up / Restore** your protected site list as a JSON file.
- **The badge shows a red `!`** when a site may have logged you out. It is empty when everything is fine.
- **Ping status stays on each computer** while the site list keeps syncing through your Firefox account.
- Fix: edits made while a ping is running are no longer lost.
- Fix: Undo restores exactly the duplicates that were closed.
- Fix: settings are no longer lost when toggled quickly.
- Fix: Live mode no longer skips tabs.

## Features

- **Group by Domain** (Alt+Shift+G): puts tabs from the same website into a group. Single tabs stay loose.
- **Ungroup All**: removes every tab group.
- **Sort** (Alt+Shift+S): orders tabs by site and title. Groups stay on top, loose tabs go below.
- **Close Duplicates** (Alt+Shift+D): closes repeated tabs, never pinned or audible ones. Undo brings back exactly those tabs.
- **Live Mode**: closes duplicates automatically as you browse. Optionally sorts and groups too, without moving your current tab.
- **Session Keepalive**: regularly visits the sites you choose in the background so they don't log you out. You grant access one site at a time.
- **Logout Alerts**: a red `!` badge and a notification when a site may have logged you out.
- **Back up / Restore**: export or import your protected site list.
- **Sync**: your site list follows your Firefox account; ping status stays local.
