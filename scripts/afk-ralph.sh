#!/bin/bash
# AFK Ralph: runs up to N rounds (default 10), one issue per round. Uses your Claude subscription.
set -e
cd "$(dirname "$0")/.."
unset ANTHROPIC_API_KEY
MAX=${1:-10}
[ -d .git ] || git init -q
TOOLS="Read,Edit,Write,Glob,Grep,Skill,Bash(npm:*),Bash(npx:*),Bash(node:*),Bash(swift:*),Bash(swiftc:*),Bash(ffmpeg:*),Bash(ls:*),Bash(mkdir:*),Bash(git add:*),Bash(git commit:*),Bash(git status:*),Bash(git diff:*),Bash(git log:*)"
for i in $(seq 1 "$MAX"); do
  echo "=== Ralph round $i of $MAX ==="
  out=$(claude -p --permission-mode acceptEdits --allowedTools "$TOOLS" -- "$(cat scripts/ralph-prompt.md)" | tee -a ralph.log)
  if echo "$out" | grep -q "<promise>COMPLETE</promise>"; then echo "All issues done."; exit 0; fi
  if echo "$out" | grep -q "<promise>BLOCKED</promise>"; then echo "Blocked: needs Ben. See progress.txt"; exit 0; fi
done
echo "Hit the $MAX-round cap. Check progress.txt."
