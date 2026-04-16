#!/usr/bin/env bash
# bd-sizing-check.sh - recommends whether a bead should be decomposed.
#
# Usage:
#   bd-sizing-check.sh <bead-id>
#   bd-sizing-check.sh --fixture <path-to-bd-show-output>
#
# Emits JSON on stdout:
#   {
#     "needs_decomposition": true|false,
#     "reasons": ["human-readable signal strings", ...]
#   }
#
# Applies a 2-of-3 heuristic over the bead's DESCRIPTION + DESIGN text:
#   (a) 4+ distinct files implied (counts explicit file paths and bullet-list items)
#   (b) spans multiple domains (backend AND frontend, or more than one backend domain)
#   (c) multiple independent deliverables (count of independent concerns / bullets)
#
# Exit codes:
#   0  Verdict emitted (regardless of needs_decomposition value)
#   2  Usage error

set -euo pipefail

usage() {
  printf 'Usage: %s <bead-id>\n       %s --fixture <path>\n' "$0" "$0" >&2
  exit 2
}

if [[ $# -lt 1 ]]; then
  usage
fi

load_content() {
  local source="$1"
  if [[ "$source" == "--fixture" ]]; then
    if [[ $# -lt 2 ]]; then
      usage
    fi
    local fixture="$2"
    if [[ ! -r "$fixture" ]]; then
      printf 'bd-sizing-check.sh: fixture not readable: %s\n' "$fixture" >&2
      exit 2
    fi
    cat -- "$fixture"
    return
  fi
  if ! command -v bd >/dev/null 2>&1; then
    printf 'bd-sizing-check.sh: bd CLI not found on PATH\n' >&2
    exit 2
  fi
  if ! bd show "$source" 2>/dev/null; then
    printf 'bd-sizing-check.sh: bd show %s failed\n' "$source" >&2
    exit 2
  fi
}

content="$(load_content "$@")"

# Extract the DESCRIPTION and DESIGN section bodies as the text we analyze.
# Stop at the next ALL-CAPS section header or EOF.
extract_section() {
  local name="$1"
  printf '%s\n' "$content" | awk -v hdr="$name" '
    $0 == hdr { inblock = 1; next }
    inblock && /^[A-Z][A-Z ]+$/ { inblock = 0 }
    inblock { print }
  '
}

scope_text="$(extract_section 'DESCRIPTION')
$(extract_section 'DESIGN')"

# -- Criterion (a): file count --
# Count explicit file-path tokens by looking for recognisable extensions in
# the scope text. Unique-ify to avoid double-counting the same file. grep
# exits non-zero when there are no matches, so we swallow that with || true.
file_paths="$(printf '%s\n' "$scope_text" \
  | grep -oE '[A-Za-z0-9_./-]+\.(ts|tsx|js|vue|scss|css|sql|md|json|yaml|yml|sh|html)' \
  | sort -u || true)"
file_count=0
if [[ -n "$file_paths" ]]; then
  file_count=$(printf '%s\n' "$file_paths" | wc -l | tr -d ' ')
fi

# -- Criterion (b): multi-domain span --
# A domain signal is any keyword that clearly implicates an area of the codebase.
# We keep this list short and obvious; the heuristic is a hint, not an oracle.
count_matches() {
  local pattern="$1"
  local n
  # grep -c exits 1 when there are zero matches; we translate that to "0".
  n=$(printf '%s\n' "$scope_text" | grep -iEc "$pattern" || true)
  [[ -z "$n" ]] && n=0
  printf '%s' "$n"
}

backend_hits=$(count_matches '\b(backend|api|service|entity|migration|sequelize|endpoint|route)\b')
frontend_hits=$(count_matches '\b(frontend|vue|component|pinia|store|site|client|scss|css)\b')
translation_hits=$(count_matches '\b(locale|translation|i18n|i18next)\b')
federation_hits=$(count_matches '\b(activitypub|federation|federated|inbox|outbox|actor)\b')

domains_spanned=0
[[ $backend_hits -gt 0 ]] && domains_spanned=$((domains_spanned + 1))
[[ $frontend_hits -gt 0 ]] && domains_spanned=$((domains_spanned + 1))
[[ $translation_hits -gt 0 ]] && domains_spanned=$((domains_spanned + 1))
[[ $federation_hits -gt 0 ]] && domains_spanned=$((domains_spanned + 1))
:

# -- Criterion (c): multiple independent deliverables --
# Count bullet-list items in the scope text. We use the same lenient match as
# most Markdown-ish renderers: a line that starts with "-", "*", or "N."
# after optional whitespace.
bullet_count=$(printf '%s\n' "$scope_text" \
  | grep -cE '^[[:space:]]*([-*]|[0-9]+\.)[[:space:]]+' || true)
[[ -z "$bullet_count" ]] && bullet_count=0

# -- Apply 2-of-3 heuristic --
reasons=()
passes=0

if [[ $file_count -ge 4 ]]; then
  reasons+=("implies $file_count or more files")
  passes=$((passes + 1))
fi

if [[ $domains_spanned -ge 2 ]]; then
  reasons+=("spans multiple domains (backend=$backend_hits, frontend=$frontend_hits, translation=$translation_hits, federation=$federation_hits)")
  passes=$((passes + 1))
fi

if [[ $bullet_count -ge 4 ]]; then
  reasons+=("$bullet_count independent deliverables listed")
  passes=$((passes + 1))
fi

needs_decomp="false"
if [[ $passes -ge 2 ]]; then
  needs_decomp="true"
else
  # Surface non-triggering signals as informational reasons when nothing
  # flagged so humans reading the output see why it was rejected.
  if [[ ${#reasons[@]} -eq 0 ]]; then
    reasons+=("fewer than 4 files, single domain, few deliverables — fits leaf size")
  fi
fi

to_json_array() {
  if [[ $# -eq 0 ]]; then
    printf '[]'
    return
  fi
  printf '%s\n' "$@" | jq -R . | jq -s .
}

reasons_json="$(to_json_array "${reasons[@]+"${reasons[@]}"}")"

jq -n \
  --argjson needs "$needs_decomp" \
  --argjson reasons "$reasons_json" \
  '{needs_decomposition: $needs, reasons: $reasons}'
