# tab-grouper

Sync GitHub PRs to browser with automatic tab grouping.

## Setup

```bash
gh auth refresh -h github.com -s read:org,repo
go build -o tab-grouper
```

**Firefox:** `./install.sh`

**Chrome:** Load `extension/` as unpacked extension at `chrome://extensions`

## Usage

```bash
./tab-grouper -daemon              # sync my PRs
./tab-grouper -daemon -review      # include review requests
./tab-grouper -daemon -interval 1m # custom sync interval
./tab-grouper -refresh             # trigger immediate refresh
./tab-grouper -install             # auto-start on login (macOS/Linux)
./tab-grouper -uninstall           # remove auto-start
```
