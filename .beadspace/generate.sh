#!/usr/bin/env bash
# Generate JSON data files for the Beadspace dashboard from .beads/ JSONL sources.
# Run this before opening index.html locally.
#
# Usage: .beadspace/generate.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

ISSUES_JSONL="$PROJECT_ROOT/.beads/issues.jsonl"
DEPS_JSONL="$PROJECT_ROOT/.beads/backup/dependencies.jsonl"
EVENTS_JSONL="$PROJECT_ROOT/.beads/backup/events.jsonl"

if [ ! -f "$ISSUES_JSONL" ]; then
    echo "Error: $ISSUES_JSONL not found. Run 'br sync --flush-only' first." >&2
    exit 1
fi

python3 -c "
import json, os, sys

def convert(src, dst):
    if not os.path.exists(src):
        json.dump([], open(dst, 'w'))
        print(f'  {os.path.basename(src)} not found, wrote empty array to {os.path.basename(dst)}')
        return
    data = [json.loads(l) for l in open(src) if l.strip()]
    json.dump(data, open(dst, 'w'))
    print(f'  {len(data)} records: {os.path.basename(src)} -> {os.path.basename(dst)}')

print('Generating Beadspace data files...')
convert('$ISSUES_JSONL', '$SCRIPT_DIR/issues.json')
convert('$DEPS_JSONL', '$SCRIPT_DIR/deps.json')
convert('$EVENTS_JSONL', '$SCRIPT_DIR/events.json')
print('Done. Open $SCRIPT_DIR/index.html in a browser.')
"
