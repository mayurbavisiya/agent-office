#!/bin/sh
# Forward a Claude Code hook event (stdin JSON) to the local Agent Office app.
# POSIX sh + curl (>= 7.55 for -H @file) only. Always exits 0 and prints nothing, so it can never
# disturb Claude Code. The token goes to curl through a here-document on fd 3, never in its argv
# (which other local users could read with ps).
cfg="${AGENT_OFFICE_DIR:-$HOME/.agent-office}/config.json"
if [ -r "$cfg" ]; then
  port=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$cfg" | head -n 1)
  token=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" | head -n 1)
  if [ -n "$port" ] && [ -n "$token" ]; then
    curl -s --max-time 1 -o /dev/null -X POST \
      -H "Content-Type: application/json" \
      -H @/dev/fd/3 \
      --data-binary @- "http://127.0.0.1:$port/event" >/dev/null 2>&1 3<<EOF_HEADER
X-Agent-Office-Token: $token
EOF_HEADER
  fi
fi
exit 0
