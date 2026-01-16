#!/bin/bash
set -e

cd "$(dirname "$0")"

go build -o tab-grouper

XPI=$(ls -t extension/web-ext-artifacts/*.xpi 2>/dev/null | head -1)
if [ -n "$XPI" ]; then
  echo "Opening extension in Firefox..."
  echo "If already installed, go to about:addons > Remove 'Tab Grouper' first"
  /Applications/Firefox.app/Contents/MacOS/firefox "$XPI"
else
  echo "Extension not found. Sign it first."
fi
