#!/bin/bash
set -e

cd "$(dirname "$0")"

echo "Building CLI..."
go build -o tab-grouper

if [[ "$1" == "-local" ]]; then
    echo ""
    echo "Done! Load extension temporarily:"
    echo "  1. Open about:debugging#/runtime/this-firefox"
    echo "  2. Click 'Load Temporary Add-on'"
    echo "  3. Select extension/manifest.json"
else
    echo ""
    echo "Opening Firefox Add-ons store..."
    echo "Please install the 'Tab Grouper' extension, then run: ./tab-grouper -start"
    
    if [[ "$(uname)" == "Darwin" ]]; then
        open "https://addons.mozilla.org/en-US/firefox/addon/424d726dc8bc4debbdfe/"
    else
        xdg-open "https://addons.mozilla.org/en-US/firefox/addon/424d726dc8bc4debbdfe/"
    fi
fi
