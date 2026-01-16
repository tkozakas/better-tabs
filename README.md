# tab-grouper

Sync GitHub PRs to Firefox with automatic tab grouping.

## Setup

```bash
./install.sh
gh auth refresh -h github.com -s read:org,repo
```

## Usage

```bash
./tab-grouper -daemon            # sync my PRs
./tab-grouper -daemon -review    # sync my PRs + review requests
./tab-grouper -refresh           # trigger immediate refresh
./tab-grouper -refresh -review   # refresh with review PRs
```
