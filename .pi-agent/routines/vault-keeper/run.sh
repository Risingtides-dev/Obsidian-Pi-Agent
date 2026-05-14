#!/bin/bash
set -e
cd "/Users/risingtidesdev/dev/Thoth"
echo "[routine] $(date -Iseconds) starting" >> "/Users/risingtidesdev/.pi/agent/routines/vault-keeper/run.log"
PROMPT=$(awk 'BEGIN{m=0} /^---$/{m++; next} m==2{print}' "/Users/risingtidesdev/.pi/agent/routines/vault-keeper/SKILL.md")
if [ -z "$PROMPT" ]; then
  echo "[routine] empty prompt, skipping" >> "/Users/risingtidesdev/.pi/agent/routines/vault-keeper/run.log"
  exit 0
fi
echo "$PROMPT" | pi -p >> "/Users/risingtidesdev/.pi/agent/routines/vault-keeper/run.log" 2>&1
RC=$?
echo "[routine] $(date -Iseconds) done (exit $RC)" >> "/Users/risingtidesdev/.pi/agent/routines/vault-keeper/run.log"
