#!/usr/bin/env bash
# Common test helpers. Source this from each test-*.sh file.
#
# Pattern: build a temp directory containing git and bd shim scripts
# that read env vars MOCK_GIT_* and MOCK_BD_* to produce canned output.
# Prepend that dir to PATH so the scripts under test see the shims.

set -u

if [ -z "${SKILL_DIR:-}" ]; then
  SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

MOCK_DIR="$(mktemp -d -t bead-backlog-test.XXXXXX)"
trap 'rm -rf "$MOCK_DIR"' EXIT

# Build git shim
cat > "$MOCK_DIR/git" <<'EOF'
#!/usr/bin/env bash
# Shim for git in fixture tests. Reads MOCK_GIT_* env vars to respond.
case "$1 ${2:-}" in
  "status --porcelain")
    echo -n "${MOCK_GIT_STATUS_PORCELAIN:-}"
    ;;
  "branch --show-current")
    echo "${MOCK_GIT_BRANCH:-main}"
    ;;
  "fetch origin")
    # Accept `git fetch origin main` or `git fetch origin`
    exit "${MOCK_GIT_FETCH_EXIT:-0}"
    ;;
  "diff origin/main"|"diff origin/main --quiet")
    exit "${MOCK_GIT_DIFF_EXIT:-0}"
    ;;
  *)
    # Accept any other form of diff with --quiet
    if [ "$1" = "diff" ]; then
      exit "${MOCK_GIT_DIFF_EXIT:-0}"
    fi
    if [ "$1" = "fetch" ]; then
      exit "${MOCK_GIT_FETCH_EXIT:-0}"
    fi
    echo "unmocked git call: $*" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$MOCK_DIR/git"

# Build bd shim
cat > "$MOCK_DIR/bd" <<'EOF'
#!/usr/bin/env bash
# Shim for bd in fixture tests. Reads MOCK_BD_* env vars to respond.
set -u

cmd="$1"
shift

case "$cmd" in
  ready)
    # bd ready --limit=N --json
    echo "${MOCK_BD_READY_JSON:-[]}"
    ;;
  label)
    sub="$1"; shift
    case "$sub" in
      list)
        id="$1"
        # MOCK_BD_LABELS_<id_normalised>, e.g. pv-abcd -> MOCK_BD_LABELS_PV_ABCD
        var="MOCK_BD_LABELS_$(echo "$id" | tr '[:lower:].-' '[:upper:]__')"
        labels="${!var:-}"
        if [ -z "$labels" ]; then
          echo "$id has no labels"
        else
          echo "🏷 Labels for $id:"
          for l in $labels; do
            echo "  - $l"
          done
        fi
        ;;
      add)
        id="$1"; label="$2"
        # Log invocation to a file so tests can assert
        echo "$id $label" >> "${MOCK_BD_LABEL_ADD_LOG:-/dev/null}"
        echo "✓ Added label '$label' to $id"
        ;;
      remove)
        id="$1"; label="$2"
        echo "$id $label" >> "${MOCK_BD_LABEL_REMOVE_LOG:-/dev/null}"
        echo "✓ Removed label '$label' from $id"
        ;;
      *)
        echo "unmocked bd label $sub" >&2
        exit 99
        ;;
    esac
    ;;
  show)
    id="$1"
    var_notes="MOCK_BD_NOTES_$(echo "$id" | tr '[:lower:].-' '[:upper:]__')"
    notes="${!var_notes:-}"
    # Check for --json
    is_json=0
    for a in "$@"; do
      [ "$a" = "--json" ] && is_json=1
    done
    if [ "$is_json" = "1" ]; then
      # Emit a minimal JSON array mimicking bd show --json
      printf '[{"id":"%s","notes":%s}]' "$id" "$(printf '%s' "$notes" | jq -Rs .)"
    else
      echo "Bead $id"
      echo ""
      echo "NOTES"
      echo "$notes"
    fi
    ;;
  update)
    id="$1"; shift
    # Parse flags
    while [ "$#" -gt 0 ]; do
      case "$1" in
        --add-label)
          echo "$id $2" >> "${MOCK_BD_LABEL_ADD_LOG:-/dev/null}"
          echo "✓ Added label '$2' to $id"
          shift 2
          ;;
        --append-notes)
          # Log one line per invocation. The note value may span many
          # lines; we replace newlines with \n so each --append-notes
          # call is recorded as exactly one line in the log.
          note_safe="$(printf '%s' "$2" | tr '\n' '|')"
          echo "$id <<<$note_safe>>>" >> "${MOCK_BD_APPEND_NOTES_LOG:-/dev/null}"
          echo "✓ Appended notes to $id"
          shift 2
          ;;
        *)
          shift
          ;;
      esac
    done
    ;;
  *)
    echo "unmocked bd $cmd" >&2
    exit 99
    ;;
esac
EOF
chmod +x "$MOCK_DIR/bd"

export PATH="$MOCK_DIR:$PATH"

# --- Assertion helpers ---

fail() {
  echo "ASSERTION FAILED: $*" >&2
  exit 1
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-}"
  if [ "$expected" != "$actual" ]; then
    fail "${msg:-values differ}
  expected: $expected
  actual:   $actual"
  fi
}

assert_json_eq() {
  local expected="$1"
  local actual="$2"
  local msg="${3:-}"
  # Compare as jq-canonicalised strings
  local e
  local a
  e="$(echo "$expected" | jq -c -S .)"
  a="$(echo "$actual" | jq -c -S .)"
  if [ "$e" != "$a" ]; then
    fail "${msg:-json differ}
  expected: $e
  actual:   $a"
  fi
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-}"
  case "$haystack" in
    *"$needle"*) ;;
    *) fail "${msg:-string missing}
  haystack: $haystack
  needle:   $needle" ;;
  esac
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local msg="${3:-}"
  case "$haystack" in
    *"$needle"*) fail "${msg:-string unexpectedly present}
  haystack: $haystack
  needle:   $needle" ;;
  esac
}
