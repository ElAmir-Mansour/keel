#!/usr/bin/env bash
# Runs the production build of this checkout at login on macOS, restarting it
# if it exits. Usage: pnpm build && scripts/macos-launch-agent.sh [port]
set -euo pipefail
PORT="${1:-3456}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.keel.local"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PNPM="$(command -v pnpm)"
NODE_BIN="$(dirname "$(command -v node)")"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/.keel-logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$PNPM</string><string>start</string><string>--port</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_BIN:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin</string>
    <key>NODE_ENV</key><string>production</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/.keel-logs/out.log</string>
  <key>StandardErrorPath</key><string>$DIR/.keel-logs/err.log</string>
</dict></plist>
PLIST
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Keel will run at http://localhost:$PORT at every login. Remove with: launchctl bootout gui/\$(id -u)/$LABEL && rm $PLIST"
