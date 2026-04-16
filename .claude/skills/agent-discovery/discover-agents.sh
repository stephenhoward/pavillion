#!/usr/bin/env bash
# discover-agents.sh — enumerate every agent file matching a suffix and emit a
# JSON array of their frontmatter summary. Suffixes are fixed: auditor,
# advisor, reviewer, verifier.
#
# Usage: discover-agents.sh <suffix>
#   suffix  one of auditor|advisor|reviewer|verifier
#
# Environment:
#   AGENTS_DIR  directory to scan; defaults to .claude/agents relative to cwd
#
# Exit codes:
#   0  success; JSON array on stdout (may be [] if no matches)
#   2  usage error (wrong or missing suffix, or AGENTS_DIR does not exist)
#
# Output shape: [{"name": "...", "path": "...", "description": "..."}, ...]
# Order: alphabetical by filename (shell glob order), which makes output
# deterministic for testing. Agents without a readable YAML frontmatter
# are skipped silently rather than emitted with empty fields.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: discover-agents.sh <suffix>

  suffix  one of: auditor, advisor, reviewer, verifier

  Emits a JSON array of matching agents with name, path, and description
  extracted from each file's YAML frontmatter.

  Override the agent directory via AGENTS_DIR (default: .claude/agents).
EOF
}

if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

SUFFIX="$1"
case "$SUFFIX" in
  auditor|advisor|reviewer|verifier) ;;
  *)
    echo "discover-agents.sh: invalid suffix '$SUFFIX' (must be auditor|advisor|reviewer|verifier)" >&2
    usage
    exit 2
    ;;
esac

AGENTS_DIR="${AGENTS_DIR:-.claude/agents}"

if [ ! -d "$AGENTS_DIR" ]; then
  echo "discover-agents.sh: AGENTS_DIR does not exist: $AGENTS_DIR" >&2
  exit 2
fi

# Extract a single YAML scalar value from the frontmatter of a file. The
# frontmatter is delimited by two `^---$` lines at the top of the file.
# Values may be quoted with double quotes. We strip surrounding quotes and
# trailing whitespace. Only the first occurrence of the key wins.
frontmatter_value() {
  local file="$1"
  local key="$2"
  # Extract the frontmatter block between the first two --- lines.
  awk -v key="$key" '
    BEGIN { in_fm = 0; saw_open = 0; found = 0 }
    /^---[[:space:]]*$/ {
      if (!saw_open) { saw_open = 1; in_fm = 1; next }
      else           { in_fm = 0; exit }
    }
    in_fm && !found {
      # Match "key: value" where key is exactly our target.
      if (match($0, "^" key "[[:space:]]*:[[:space:]]*")) {
        value = substr($0, RLENGTH + 1)
        # Strip leading/trailing whitespace.
        sub(/^[[:space:]]+/, "", value)
        sub(/[[:space:]]+$/, "", value)
        # Strip surrounding double quotes if present.
        if (match(value, /^".*"$/)) {
          value = substr(value, 2, length(value) - 2)
        }
        print value
        found = 1
      }
    }
  ' "$file"
}

# Iterate fixed-glob pattern. Use `find` with -maxdepth 1 so we do not recurse
# and we get a stable, alphabetical order via sort.
result='[]'
while IFS= read -r path; do
  [ -z "$path" ] && continue
  name="$(frontmatter_value "$path" name)"
  description="$(frontmatter_value "$path" description)"
  # Skip files missing a name — they are malformed.
  if [ -z "$name" ]; then
    continue
  fi
  result="$(jq -c \
    --arg name "$name" \
    --arg path "$path" \
    --arg description "$description" \
    '. + [{name: $name, path: $path, description: $description}]' \
    <<< "$result")"
done < <(find "$AGENTS_DIR" -maxdepth 1 -type f -name "*-${SUFFIX}.md" 2>/dev/null | LC_ALL=C sort)

echo "$result"
