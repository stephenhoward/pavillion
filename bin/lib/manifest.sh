#!/usr/bin/env bash
# Manifest parser helpers. Source from deploy.sh and check-manifest.sh.
#
# The manifest schema is flat and controlled — each entry is exactly four
# fields at fixed indentation. That lets us parse with awk instead of
# bringing in a YAML library.

# parse_manifest <path> -> stdout: one pipe-delimited record per entry
#   name|generator|stability|description
parse_manifest() {
  local path="$1"
  awk '
    BEGIN { name=""; generator=""; stability=""; description="" }

    function emit() {
      if (name != "") {
        print name "|" generator "|" stability "|" description
      }
      name=""; generator=""; stability=""; description=""
    }

    /^  - name:[[:space:]]+/ {
      emit()
      sub(/^  - name:[[:space:]]+/, "")
      name=$0
      next
    }
    /^    generator:[[:space:]]+/ {
      sub(/^    generator:[[:space:]]+/, "")
      generator=$0
      next
    }
    /^    stability:[[:space:]]+/ {
      sub(/^    stability:[[:space:]]+/, "")
      stability=$0
      next
    }
    /^    description:[[:space:]]+/ {
      sub(/^    description:[[:space:]]+/, "")
      description=$0
      next
    }

    END { emit() }
  ' "$path"
}

# manifest_names <path> -> stdout: one secret name per line
manifest_names() {
  parse_manifest "$1" | cut -d'|' -f1
}

# manifest_field <path> <name> <field> -> stdout: the field value
#   field ∈ { generator, stability, description }
manifest_field() {
  local path="$1"
  local wanted="$2"
  local field="$3"
  local col
  case "$field" in
    generator)   col=2 ;;
    stability)   col=3 ;;
    description) col=4 ;;
    *) echo "manifest_field: unknown field '${field}'" >&2; return 1 ;;
  esac
  parse_manifest "$path" | awk -F'|' -v want="$wanted" -v c="$col" '$1 == want { print $c }'
}
