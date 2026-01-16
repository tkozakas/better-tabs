#!/bin/bash
set -e

cd "$(dirname "$0")"

# Load AMO credentials
source ~/.bashrc 2>/dev/null || true
if [ -z "$AMO_API_KEY" ] || [ -z "$AMO_API_SECRET" ]; then
    export AMO_API_KEY="user:19685541:831"
    export AMO_API_SECRET="0ad7d8d85cc6105cdf431363024aac85c51ec54b49aa85e105d14b2ab9cc17be"
fi

echo "Building CLI..."
go build -o tab-grouper

echo "Packaging extension..."
cd extension
rm -f web-ext-artifacts/*.xpi web-ext-artifacts/*.zip 2>/dev/null || true

# Add local npm bin to PATH
export PATH="$HOME/.local/bin:$PATH"

# Install web-ext if needed
if ! command -v web-ext &>/dev/null; then
    echo "Installing web-ext..."
    npm install -g web-ext --prefix ~/.local
fi

# Sign and publish to AMO
echo "Publishing to AMO..."
web-ext sign \
    --api-key="$AMO_API_KEY" \
    --api-secret="$AMO_API_SECRET" \
    --channel=listed \
    --artifacts-dir=web-ext-artifacts \
    --ignore-files=".amo-upload-uuid" "amo-metadata.json" "web-ext-artifacts"

echo ""
echo "Extension published! Install from:"
echo "https://addons.mozilla.org/firefox/addon/pr-tab-grouper/"
