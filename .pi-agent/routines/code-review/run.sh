#!/bin/bash
set -e
cd "{{VAULT_PATH}}"
echo "[routine] $(date -Iseconds) starting" >> "{{HOME_PATH}}/.pi/agent/routines/code-review/run.log"
PROMPT=$(awk 'BEGIN{m=0} /^---$/{m++; next} m==2{print}' "{{HOME_PATH}}/.pi/agent/routines/code-review/SKILL.md")
if [ -z "$PROMPT" ]; then
  echo "[routine] empty prompt, skipping" >> "{{HOME_PATH}}/.pi/agent/routines/code-review/run.log"
  exit 0
fi
echo "$PROMPT" | pi -p >> "{{HOME_PATH}}/.pi/agent/routines/code-review/run.log" 2>&1
RC=$?
echo "[routine] $(date -Iseconds) done (exit $RC)" >> "{{HOME_PATH}}/.pi/agent/routines/code-review/run.log"
