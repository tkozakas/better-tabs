# Tab Grouper

Sync GitHub PRs to browser tabs with automatic tab grouping.

## Features

- Opens tabs for your open GitHub PRs
- Auto-closes tabs when PRs are merged
- Groups tabs by domain (Firefox 139+)
- Two modes: **Standalone** (extension only) or **CLI daemon**

## Installation

### Extension Only (Recommended)

1. Install from [Firefox Add-ons](https://addons.mozilla.org/firefox/addon/pr-tab-grouper/)
2. Click extension icon → Login with GitHub
3. Done! PRs sync automatically every 15 seconds

### With CLI Daemon

For power users who prefer CLI control:

```bash
# Build
go build -o tab-grouper

# Start daemon
./tab-grouper -start

# Install extension and enable "Use CLI daemon" in popup
```

## CLI Commands

```bash
./tab-grouper -start              # Start daemon as background service
./tab-grouper -shutdown           # Stop daemon
./tab-grouper -refresh            # Trigger immediate refresh
./tab-grouper -group              # Group all tabs by domain
./tab-grouper -enable-review      # Include review-requested PRs
./tab-grouper -disable-review     # Exclude review-requested PRs
./tab-grouper -set-interval 30s   # Change sync interval
```

## Requirements

- Firefox 139+ (for tab groups API)
- For CLI mode: `gh` CLI authenticated (`gh auth login`)
