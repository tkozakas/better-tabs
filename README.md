# Tab Grouper

Manage browser tabs: group by domain, sort, close duplicates, and sync GitHub PRs.

## Install

```bash
./install.sh
```

## Features

- **Group by Domain** - Organize tabs into groups by website
- **Ungroup All** - Remove all tab groups
- **Sort Alphabetically** - Sort tabs by URL
- **Close Duplicates** - Remove duplicate tabs
- **GitHub PR Sync** - Auto-open your open PRs as tabs

## CLI (Optional)

```bash
./tab-grouper -start       # Start daemon
./tab-grouper -shutdown    # Stop daemon
./tab-grouper -refresh     # Trigger refresh
./tab-grouper -group       # Group tabs by domain
```

Requires `gh` CLI authenticated (`gh auth login`).
