#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
EXT_ID="pr-tab-grouper@localhost"
APP_NAME="pr_tab_grouper"

echo "Building pr-aggregator..."
cd "$SCRIPT_DIR"
go build -o pr-aggregator

case "$(uname)" in
  Darwin)
    NATIVE_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
    ;;
  Linux)
    NATIVE_DIR="$HOME/.mozilla/native-messaging-hosts"
    ;;
  *)
    echo "Unsupported OS"
    exit 1
    ;;
esac

mkdir -p "$NATIVE_DIR"

cat > "$NATIVE_DIR/$APP_NAME.json" << EOF
{
  "name": "$APP_NAME",
  "description": "PR Aggregator native messaging host",
  "path": "$SCRIPT_DIR/pr-aggregator",
  "type": "stdio",
  "allowed_extensions": ["$EXT_ID"]
}
EOF

echo "Native messaging host installed"

XPI=$(find "$SCRIPT_DIR/extension/web-ext-artifacts" -name "*.xpi" 2>/dev/null | head -1)
if [ -n "$XPI" ]; then
  echo "Opening extension for installation..."
  case "$(uname)" in
    Darwin)
      open -a Firefox "$XPI"
      ;;
    Linux)
      firefox "$XPI"
      ;;
  esac
  echo "Click 'Add' in Firefox to install the extension"
else
  echo "Extension not found. Run with API keys to sign:"
  echo "  AMO_API_KEY=key AMO_API_SECRET=secret ./install.sh"
fi
