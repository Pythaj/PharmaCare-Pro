#!/bin/bash
cd /home/z/my-project
while true; do
  bun run dev &
  DEV_PID=$!
  # Keep alive for 10 minutes max per run
  for i in $(seq 1 600); do
    if ! kill -0 $DEV_PID 2>/dev/null; then
      echo "[$(date)] Process died, restarting..."
      break
    fi
    sleep 1
  done
  kill $DEV_PID 2>/dev/null
  echo "[$(date)] Restarting server..."
done
