#!/bin/bash
# Get Obsidian's current active file, copy absolute path to clipboard
VAULT="${VAULT_PATH:-$(cd "$(dirname "$0")/.." && pwd)}"

# Read active file from workspace state
FILE=$(python3 -c "
import json
with open('$VAULT/.obsidian/workspace.json') as f:
    data = json.load(f)
files = data.get('lastOpenFiles', [])
print(files[0] if files else '')
")

if [ -n "$FILE" ]; then
    echo "$VAULT/$FILE" | pbcopy
    echo "Copied: $VAULT/$FILE"
else
    echo "No active file found"
fi
