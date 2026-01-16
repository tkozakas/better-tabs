# pr-aggregator

Fetch and open your GitHub PRs in browser with tab grouping.

## Setup

```bash
go build -o pr-aggregator
gh auth refresh -h github.com -s read:org,repo
./install.sh
```

## Usage

```bash
./pr-aggregator                 # list your open PRs
./pr-aggregator -review         # list PRs pending your review
./pr-aggregator -open           # open PRs in "My PRs" group
./pr-aggregator -review -open   # open PRs in "Review PRs" group
```

## Flags

| Flag | Description |
|------|-------------|
| `-open` | Open PRs in browser (skips already open) |
| `-review` | Show PRs where you are requested as reviewer |
