#!/usr/bin/env bash
# match-agents.sh — pick which agents (of a given suffix) apply to a set of
# changed files. Reads changed-file paths from stdin (one per line) and
# emits a JSON array of matched agents with per-agent rationale.
#
# Usage: match-agents.sh <suffix>
#   suffix  one of auditor|advisor|reviewer|verifier
#
# Environment:
#   AGENTS_DIR  directory to scan; defaults to .claude/agents relative to cwd
#
# Exit codes:
#   0  success; JSON array on stdout (may be [] if no matches or no files)
#   2  usage error (bad suffix, missing suffix, or AGENTS_DIR missing)
#
# Output shape:
#   [{"name": "...", "path": "...", "description": "...",
#     "rationale": "<filename pattern> matched <agent> (<description keyword>)"}, ...]
#
# Matching model
# --------------
# Each agent is tagged with zero or more "keyword tags" (a11y, style, etc.).
# Each changed file is tagged with zero or more tags based on its path/suffix.
# An agent matches when its tag set intersects the file set's tag set.
#
# The tag table is the SOURCE OF TRUTH for what an agent applies to. SKILL.md
# restates the intent in a human-readable form; this script is authoritative.

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
usage: match-agents.sh <suffix> < <changed-files-list>

  suffix  one of: auditor, advisor, reviewer, verifier

  Reads one changed-file path per line on stdin. Emits a JSON array of
  matching agents; each entry has name, path, description, and rationale.
  If stdin is empty or no agents match, emits `[]`.

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
    echo "match-agents.sh: invalid suffix '$SUFFIX' (must be auditor|advisor|reviewer|verifier)" >&2
    usage
    exit 2
    ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DISCOVER="$SCRIPT_DIR/discover-agents.sh"

# --- File → tag mapping ---------------------------------------------------
# Returns a space-separated list of tags for a changed file path. Tags are
# keywords like `vue`, `scss`, `api`, `entity`, `test`, `migration`, `i18n`,
# `script`, `infra`. A file may carry multiple tags.
file_tags() {
  local f="$1"
  local tags=""

  # Vue SFCs — frontend concerns (a11y, style, component standards, i18n).
  case "$f" in
    *.vue)            tags="$tags vue" ;;
  esac

  # SCSS / CSS stylesheets.
  case "$f" in
    *.scss|*.css)     tags="$tags scss" ;;
  esac

  # Test files (vitest + playwright conventions).
  case "$f" in
    *.test.ts|*.spec.ts|*.test.js|*.spec.js|*.test.vue|*.spec.vue) tags="$tags test" ;;
  esac

  # API handlers — every server domain's api/ folder.
  case "$f" in
    src/server/*/api/*) tags="$tags api" ;;
  esac

  # Entities and models — data-layer concerns.
  case "$f" in
    src/server/*/entity/*)  tags="$tags entity" ;;
    src/server/*/model/*)   tags="$tags model" ;;
    src/common/model/*)     tags="$tags model" ;;
  esac

  # Service layer — cross-domain logic, where business logic lives.
  case "$f" in
    src/server/*/service/*) tags="$tags service" ;;
  esac

  # Migrations — schema / data changes, high security/privacy relevance.
  case "$f" in
    src/server/*/migration/*|src/server/*/migrations/*|*/migration/*.ts|*/migrations/*.ts) tags="$tags migration" ;;
  esac

  # i18n resource bundles.
  case "$f" in
    src/client/locales/*|src/site/locales/*|src/server/*/locales/*|*/locales/*.json|*/locale/*.json) tags="$tags i18n" ;;
  esac

  # Infra / scripts / configuration / docs.
  case "$f" in
    *.sh)              tags="$tags script" ;;
    .claude/*|docs/*)  tags="$tags infra" ;;
  esac

  # Trim leading space.
  echo "${tags## }"
}

# --- Agent → tag + keyword phrase mapping --------------------------------
# For each known agent (name), print two tab-separated fields on stdout:
#   TAGS (space-separated)   KEYWORD_PHRASE (for rationale)
# The keyword phrase is a short snippet from the agent's description that
# justifies the match; it goes into the rationale string.
agent_profile() {
  local name="$1"
  case "$name" in
    accessibility-auditor|accessibility-advisor)
      echo "vue	WCAG / Vue accessibility" ;;
    stylesheet-auditor|stylesheet-advisor)
      echo "vue scss	stylesheet quality / design tokens" ;;
    frontend-standards-reviewer)
      echo "vue scss i18n	frontend standards (Vue/SCSS/TypeScript/i18n/Pinia)" ;;
    i18n-auditor|i18n-advisor)
      echo "vue i18n	i18n compliance" ;;
    consistency-auditor|consistency-advisor)
      echo "vue api service entity model test i18n script infra	pattern consistency / convention drift" ;;
    architecture-auditor|architecture-advisor)
      echo "api service entity model migration	architectural clarity" ;;
    privacy-auditor|privacy-advisor)
      echo "api service model entity migration	PII / data exposure" ;;
    security-auditor|security-advisor)
      echo "api service migration	SQL injection / auth / SSRF / IDOR / XSS" ;;
    testing-auditor|testing-advisor)
      echo "test	test quality / coverage" ;;
    complexity-auditor|complexity-advisor)
      echo "api service entity model vue scss test script infra	unnecessary complexity / YAGNI" ;;
    cross-bead-integration-verifier)
      # Integration verifier always applies when there are multiple files
      # from different areas; the orchestrator decides whether to run it
      # based on wave size, not via this matcher. Leave tags empty so it
      # does not auto-match.
      echo "	" ;;
    build-guardian)
      echo "	" ;;
    test-failure-investigator)
      echo "test	failing test diagnosis" ;;
    *)
      echo "	" ;;
  esac
}

# --- Main ----------------------------------------------------------------

# Read changed-files from stdin.
changed_files=()
while IFS= read -r line; do
  [ -z "$line" ] && continue
  changed_files+=("$line")
done

# If no files were given, emit empty array and exit cleanly.
if [ "${#changed_files[@]}" -eq 0 ]; then
  echo "[]"
  exit 0
fi

# Collect all tags across changed files, with the first file that
# contributed each tag (for rationale).
# Parallel arrays: seen_tags[i], seen_tag_file[i]
seen_tags=()
seen_tag_file=()
tag_seen() {
  local needle="$1"
  local i
  for i in "${!seen_tags[@]}"; do
    if [ "${seen_tags[$i]}" = "$needle" ]; then
      return 0
    fi
  done
  return 1
}
for f in "${changed_files[@]}"; do
  tags="$(file_tags "$f")"
  for t in $tags; do
    if ! tag_seen "$t"; then
      seen_tags+=("$t")
      seen_tag_file+=("$f")
    fi
  done
done

# Discover candidate agents for this suffix.
agents_json="$("$DISCOVER" "$SUFFIX")"

# Walk each agent and check for tag overlap.
result='[]'
count="$(jq 'length' <<< "$agents_json")"
for ((i = 0; i < count; i++)); do
  name="$(jq -r ".[$i].name" <<< "$agents_json")"
  path="$(jq -r ".[$i].path" <<< "$agents_json")"
  description="$(jq -r ".[$i].description" <<< "$agents_json")"

  profile="$(agent_profile "$name")"
  agent_tags="$(printf '%s' "$profile" | cut -f1)"
  keyword_phrase="$(printf '%s' "$profile" | cut -f2)"

  # No tags → the matcher doesn't claim this agent; skip.
  if [ -z "$agent_tags" ]; then
    continue
  fi

  # Find first file that shares at least one tag with this agent.
  matched_file=""
  matched_tag=""
  for t in $agent_tags; do
    # Look up which file (if any) contributed this tag.
    idx=-1
    for j in "${!seen_tags[@]}"; do
      if [ "${seen_tags[$j]}" = "$t" ]; then
        idx=$j
        break
      fi
    done
    if [ "$idx" -ge 0 ]; then
      matched_file="${seen_tag_file[$idx]}"
      matched_tag="$t"
      break
    fi
  done

  if [ -z "$matched_file" ]; then
    continue
  fi

  rationale="file '$matched_file' (tag: $matched_tag) matches $name (${keyword_phrase})"

  result="$(jq -c \
    --arg name "$name" \
    --arg path "$path" \
    --arg description "$description" \
    --arg rationale "$rationale" \
    '. + [{name: $name, path: $path, description: $description, rationale: $rationale}]' \
    <<< "$result")"
done

echo "$result"
