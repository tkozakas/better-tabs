#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building CLI..."
go build -o tab-grouper

echo ""
echo "Done! Load extension temporarily:"
echo "  1. Open about:debugging#/runtime/this-firefox"
echo "  2. Click 'Load Temporary Add-on'"
echo "  3. Select extension/manifest.json"
