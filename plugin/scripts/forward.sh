#!/bin/sh
# Forward a Claude Code hook event (stdin JSON) to the local Agent Office app.
# POSIX sh + curl only. Always exits 0 so it can never disturb Claude Code.
cfg="$HOME/.agent-office/config.json"
if [ -r "$cfg" ]; then
  port=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$cfg" | head -n 1)
  token=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" | head -n 1)
  if [ -n "$port" ] && [ -n "$token" ]; then
    curl -s --max-time 1 -o /dev/null -X POST \
      -H "Content-Type: application/json" \
      -H "X-Agent-Office-Token: $token" \
      --data-binary @- "http://127.0.0.1:$port/event" >/dev/null 2>&1
  fi
fi
exit 0
