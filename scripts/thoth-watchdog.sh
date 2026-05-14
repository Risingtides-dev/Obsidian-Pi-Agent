#!/bin/bash
# thoth-pi-watchdog — keeps Pi alive in the vault directory
# Run this instead of running `pi` directly.
# When Pi exits, it auto-restarts after 2 seconds.

VAULT="/Users/risingtidesdev/dev/Thoth"

cd "$VAULT" || exit 1

restart_count=0

while true; do
  echo "┌─────────────────────────────────────┐"
  echo "│  Thoth Pi Watchdog                  │"
  if [ $restart_count -gt 0 ]; then
    echo "│  Restart #$restart_count                         │"
  fi
  echo "├─────────────────────────────────────┤"
  echo "│  Session: $(date '+%Y-%m-%d %H:%M:%S')          │"
  echo "│  Dir:     $VAULT"
  echo "└─────────────────────────────────────┘"

  pi

  restart_count=$((restart_count + 1))
  echo ""
  echo "Pi exited. Restarting in 2 seconds... (Ctrl+C to stop)"
  sleep 2
done
