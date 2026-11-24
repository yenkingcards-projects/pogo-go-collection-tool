#!/bin/bash
# One hands-on Ralph round. You watch and approve. Uses your Claude subscription.
set -e
cd "$(dirname "$0")/.."
unset ANTHROPIC_API_KEY
[ -d .git ] || git init -q
claude --permission-mode acceptEdits "$(cat scripts/ralph-prompt.md)"
