#!/bin/bash
set -e

cd "$(dirname "$0")"

go build -o tab-grouper

XPI=$(ls -t extension/web-ext-artifacts/*.xpi 2>/dev/null | head -1)
if [ -n "$XPI" ]; then
  /Applications/Firefox.app/Contents/MacOS/firefox "$XPI"
  echo "Click 'Add' in Firefox to install"
else
  echo "Extension not found. Sign it first."
fi
