#!/usr/bin/env bash
# Manifest parser helpers. Source from deploy.sh and check-manifest.sh.
#
# The manifest is a tab-separated file with four columns per record:
#   name<TAB>generator<TAB>stability<TAB>description
#
# Comment lines (starting with `#`) and blank lines are ignored. Bash's
# built-in `read -r` parses TSV natively, so no external tools (awk, jq)
# are needed — important on minimal Debian hosts.

# parse_manifest <path> -> stdout: one pipe-delimited record per entry
#   name|generator|stability|description
parse_manifest() {
  local path="$1"
  while IFS=$'\t' read -r name generator stability description; do
    [[ -z "$name" || "$name" =~ ^# ]] && continue
    printf '%s|%s|%s|%s\n' "$name" "$generator" "$stability" "$description"
  done < "$path"
}

# manifest_names <path> -> stdout: one secret name per line
manifest_names() {
  parse_manifest "$1" | cut -d'|' -f1
}

# manifest_field <path> <name> <field> -> stdout: the field value
#   field ∈ { generator, stability, description }
manifest_field() {
  local path="$1" wanted="$2" field="$3"
  case "$field" in
    generator|stability|description) ;;
    *) echo "manifest_field: unknown field '${field}'" >&2; return 1 ;;
  esac
  local name generator stability description
  while IFS='|' read -r name generator stability description; do
    if [[ "$name" == "$wanted" ]]; then
      case "$field" in
        generator)   printf '%s\n' "$generator" ;;
        stability)   printf '%s\n' "$stability" ;;
        description) printf '%s\n' "$description" ;;
      esac
      return 0
    fi
  done < <(parse_manifest "$path")
}
