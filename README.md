# Tab Grouper

Sync GitHub PRs to browser tabs with automatic tab grouping.

## Install

```bash
./install.sh
```

## CLI (Optional)

```bash
./tab-grouper -start              # Start daemon as background service
./tab-grouper -shutdown           # Stop daemon
./tab-grouper -refresh            # Trigger immediate refresh
./tab-grouper -group              # Group all tabs by domain
./tab-grouper -enable-review      # Include review-requested PRs
./tab-grouper -disable-review     # Exclude review-requested PRs
./tab-grouper -set-interval 30s   # Change sync interval
```

Enable "Use CLI daemon" in the extension popup to connect.

Requires `gh` CLI authenticated (`gh auth login`).
