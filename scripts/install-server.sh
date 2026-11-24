#!/bin/zsh
# Installs Lilycove Co as a login item (launchd) on port 4242. Safe to re-run.
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.ben.lilycoveco
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/lilycove.log"
NODE="$(command -v node)"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>$LABEL</string>
<key>ProgramArguments</key><array><string>$NODE</string><string>--import</string><string>tsx</string><string>src/main.ts</string></array>
<key>WorkingDirectory</key><string>$DIR</string>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>StandardOutPath</key><string>$LOG</string>
<key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 3
if curl -sf localhost:4242/api/count >/dev/null; then
  echo "Lilycove Co is running: http://localhost:4242"
else
  echo "Not responding yet. Last log lines:"; tail -5 "$LOG"
fi
