#!/bin/sh
# Forward a Claude Code hook event (stdin JSON) to the local Agent Office tracker.
# POSIX sh + curl (>= 7.55 for -H @file) only. Always exits 0 and prints nothing, so it can never
# disturb Claude Code. The token goes to curl through a here-document on fd 3, never in its argv
# (which other local users could read with ps).
#
# The event only goes to Agent Office's own tracker, straight over loopback:
# - only while the tracker is running: its pid file names a live process of this user (kill -0 fails
#   for anyone else's), so whatever else might listen on the port while the office is off gets nothing;
# - -q skips ~/.curlrc, --noproxy '*' ignores http_proxy/ALL_PROXY (curl proxies 127.0.0.1 otherwise),
#   and redirects are refused.
dir="${AGENT_OFFICE_DIR:-$HOME/.agent-office}"
cfg="$dir/config.json"
pid=$(cat "$dir/tracker.pid" 2>/dev/null)
case "$pid" in ''|*[!0-9]*) exit 0 ;; esac
kill -0 "$pid" 2>/dev/null || exit 0
if [ -r "$cfg" ]; then
  port=$(sed -n 's/.*"port"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$cfg" | head -n 1)
  token=$(sed -n 's/.*"token"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$cfg" | head -n 1)
  if [ -n "$port" ] && [ -n "$token" ]; then
    curl -q -s --noproxy '*' --proto =http --max-redirs 0 --max-time 1 -o /dev/null -X POST \
      -H "Content-Type: application/json" \
      -H @/dev/fd/3 \
      --data-binary @- "http://127.0.0.1:$port/event" >/dev/null 2>&1 3<<EOF_HEADER
X-Agent-Office-Token: $token
EOF_HEADER
  fi
fi
exit 0
