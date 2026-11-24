#!/bin/zsh
# Double-click to install/start Lilycove Co (runs scripts/install-server.sh). Safe to re-run.
cd "$(dirname "$0")"
./scripts/install-server.sh
echo
echo "Open on this Mac:   http://localhost:4242"
echo "Open on iPhone:     http://benjamins-macbook-pro.tailc16119.ts.net:4242"
echo
echo "You can close this window. Lilycove Co keeps running in the background."
