#!/usr/bin/env bash
# check-manifest.sh — CI lint for bin/deploy-manifest.tsv.
#
# Verifies that every secret declared in the manifest is wired into the
# four plumbing files:
#   1. config/custom-environment-variables.yaml  (env → config key binding)
#   2. docker-compose.yml                        (app + worker environment)
#   3. bin/entrypoint.sh                         (file_env list)
#   4. src/server/common/helper/production-validation.ts  (hard-fail check)
#
# Flags (override defaults; used by tests):
#   --manifest=<path>
#   --envvars=<path>
#   --compose=<path>
#   --entrypoint=<path>
#   --validator=<path>
#
# Exit codes:
#   0  all secrets are fully wired
#   1  at least one plumbing reference is missing
#   2  the manifest itself could not be read

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/manifest.sh"

MANIFEST="${REPO_ROOT}/bin/deploy-manifest.tsv"
ENVVARS="${REPO_ROOT}/config/custom-environment-variables.yaml"
COMPOSE="${REPO_ROOT}/docker-compose.yml"
ENTRYPOINT="${REPO_ROOT}/bin/entrypoint.sh"
VALIDATOR="${REPO_ROOT}/src/server/common/helper/production-validation.ts"

for arg in "$@"; do
  case "$arg" in
    --manifest=*)   MANIFEST="${arg#*=}" ;;
    --envvars=*)    ENVVARS="${arg#*=}" ;;
    --compose=*)    COMPOSE="${arg#*=}" ;;
    --entrypoint=*) ENTRYPOINT="${arg#*=}" ;;
    --validator=*)  VALIDATOR="${arg#*=}" ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "check-manifest: unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "check-manifest: manifest not found: ${MANIFEST}" >&2
  exit 2
fi

errors=0
report_missing() {
  local name="$1"
  local file="$2"
  local hint="$3"
  echo "ERROR: ${name} missing from ${file} — ${hint}" >&2
  errors=$((errors+1))
}

# Count occurrences of an extended-regex pattern in a file.
count_matches() {
  local pattern="$1"
  local file="$2"
  grep -cE "$pattern" "$file" || true
}

# Read all secret names once. Avoid `mapfile` for compatibility with
# bash 3.2 (the default on macOS).
names=()
while IFS= read -r line; do
  [[ -n "$line" ]] && names+=("$line")
done < <(manifest_names "$MANIFEST")

for name in "${names[@]}"; do
  # 1. custom-environment-variables.yaml
  # Must appear as a mapped value (right-hand side of a YAML mapping).
  if ! grep -qE "^[[:space:]]+[a-zA-Z_]+:[[:space:]]+${name}\$" "$ENVVARS"; then
    report_missing "$name" "$ENVVARS" "add an entry mapping a config key to ${name}"
  fi

  # 2. docker-compose.yml — must appear in BOTH app and worker environment
  # blocks, once as the plain env var and once as the _FILE variant. We
  # confirm "in both blocks" by requiring at least 2 occurrences of each
  # line pattern.
  plain_count=$(count_matches "^[[:space:]]+- ${name}=\\\$\\{${name}:-" "$COMPOSE")
  if [[ "$plain_count" -lt 2 ]]; then
    report_missing "$name" "$COMPOSE" "add '- ${name}=\${${name}:-}' to both app and worker environment blocks"
  fi
  file_count=$(count_matches "^[[:space:]]+- ${name}_FILE=\\\$\\{${name}_FILE:-" "$COMPOSE")
  if [[ "$file_count" -lt 2 ]]; then
    report_missing "${name}_FILE" "$COMPOSE" "add '- ${name}_FILE=\${${name}_FILE:-}' to both app and worker environment blocks"
  fi

  # 3. entrypoint.sh — must appear in the file_env list.
  if ! grep -qE "file_env '${name}'" "$ENTRYPOINT"; then
    report_missing "$name" "$ENTRYPOINT" "add \"file_env '${name}'\" to the production secrets block"
  fi

  # 4. production-validation.ts — must be referenced somewhere.
  if ! grep -q "${name}" "$VALIDATOR"; then
    report_missing "$name" "$VALIDATOR" "add a production-validation check for ${name}"
  fi
done

if [[ $errors -gt 0 ]]; then
  echo "" >&2
  echo "check-manifest: ${errors} plumbing issue(s). Every manifest entry must be wired into all four plumbing files." >&2
  exit 1
fi

echo "check-manifest: all ${#names[@]} manifest entries are fully wired."
