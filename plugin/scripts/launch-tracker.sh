#!/bin/sh
# Start the Agent Office tracker detached: launch-tracker.sh <plugin root>
# Prints the child's pid and exits 0; exits 3 when node is missing or older than v20, 2 on bad usage.
# The tracker reads its port and token from AGENT_OFFICE_DIR (or ~/.agent-office) itself, so no
# secret ever passes through this script's argv or output.
root="$1"
if [ -z "$root" ] || [ ! -f "$root/tracker/tracker.mjs" ]; then
  echo "usage: launch-tracker.sh <plugin root>" >&2
  exit 2
fi
command -v node >/dev/null 2>&1 || exit 3
major=$(node --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\).*/\1/p')
[ -n "$major" ] && [ "$major" -ge 20 ] || exit 3
nohup node "$root/tracker/tracker.mjs" --started-by plugin >/dev/null 2>&1 </dev/null &
echo $!
exit 0
