#!/usr/bin/env bash
# bin/deploy.sh — Pavillion's single entry point for install, upgrade, and redeploy.
#
# Modes (auto-detected):
#   install   — no .env present. Generates all secrets, prompts for domain,
#               creates config/local.yaml, runs docker compose up.
#   upgrade   — .env present. Optionally git pulls, generates any missing
#               'regenerable' secrets, prompts (or bails) for missing
#               'stable' secrets, runs docker compose pull + up.
#
# Flags:
#   --non-interactive
#       Do not prompt. Fail fast with an actionable error if a 'stable'
#       secret is missing or if --domain is required but absent.
#   --skip-git-pull
#       Skip the git pull step in upgrade mode.
#   --domain=<value>
#       First-install domain. Ignored on upgrade.
#   --health-timeout=<seconds>
#       How long to poll /health before declaring failure. Default 120.
#   --help
#       Print this help and exit 0.
#
# Exit codes:
#   0  success (including "nothing to do")
#   1  generic failure
#   2  missing 'stable' secret in non-interactive mode
#   3  safety check failed (dirty tree, wrong directory, etc.)
#   4  docker compose up succeeded but /health never returned 200

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/manifest.sh"

# Defaults
NON_INTERACTIVE=0
SKIP_GIT_PULL=0
DOMAIN=""
HEALTH_TIMEOUT=120
MANIFEST="${REPO_ROOT}/bin/deploy-manifest.yaml"
ENV_FILE="${REPO_ROOT}/.env"
SECRETS_DIR="${REPO_ROOT}/secrets"
DEPLOY_STATE_FILE="${REPO_ROOT}/.deploy-state"

# Debug/test flags
DEBUG_DIFF=0
DEBUG_GENERATE=""
DEBUG_RESOLVE=0

# ANSI colors (only when stdout is a TTY)
if [[ -t 1 ]]; then
  C_RED=$'\033[0;31m'
  C_GREEN=$'\033[0;32m'
  C_YELLOW=$'\033[1;33m'
  C_BLUE=$'\033[0;34m'
  C_BOLD=$'\033[1m'
  C_RESET=$'\033[0m'
else
  C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_BOLD=""; C_RESET=""
fi

log_info()    { echo -e "${C_BLUE}[INFO]${C_RESET} $*"; }
log_success() { echo -e "${C_GREEN}[OK]${C_RESET} $*"; }
log_warn()    { echo -e "${C_YELLOW}[WARN]${C_RESET} $*"; }
log_error()   { echo -e "${C_RED}[ERROR]${C_RESET} $*" >&2; }

print_help() {
  sed -n '/^# bin\/deploy.sh/,/^$/p' "$0" | sed 's/^# \{0,1\}//'
}

parse_args() {
  for arg in "$@"; do
    case "$arg" in
      --non-interactive) NON_INTERACTIVE=1 ;;
      --skip-git-pull)   SKIP_GIT_PULL=1 ;;
      --domain=*)        DOMAIN="${arg#*=}" ;;
      --health-timeout=*) HEALTH_TIMEOUT="${arg#*=}" ;;
      --diff-only)       DEBUG_DIFF=1 ;;
      --generate=*)      DEBUG_GENERATE="${arg#*=}" ;;
      --resolve-only)    DEBUG_RESOLVE=1 ;;
      -h|--help)         print_help; exit 0 ;;
      *)
        log_error "unknown argument: ${arg}"
        echo "Run '$(basename "$0") --help' for usage." >&2
        exit 1
        ;;
    esac
  done

  # Non-TTY implies non-interactive even if flag not passed.
  if [[ ! -t 0 ]]; then
    NON_INTERACTIVE=1
  fi
}

detect_mode() {
  if [[ -f "$ENV_FILE" ]]; then
    echo "upgrade"
  else
    echo "install"
  fi
}

# ---- Secret generators ----

generate_secret() {
  local generator="$1"
  case "$generator" in
    openssl_rand_base64_32) openssl rand -base64 32 ;;
    openssl_rand_hex_32)    openssl rand -hex 32 ;;
    *)
      log_error "unknown generator: ${generator}"
      return 1
      ;;
  esac
}

# ---- .env helpers ----

# env_has <env_file> <name> -> exit 0 if the var is set to a non-empty value
env_has() {
  local file="$1"
  local name="$2"
  [[ -f "$file" ]] || return 1
  # Match "NAME=value" where value is non-empty.
  grep -qE "^${name}=.+\$" "$file"
}

# env_names <env_file> -> stdout: one variable name per line (anything before '=')
env_names() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # Skip blank lines and comments. Only emit lines that look like assignments.
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$file" | cut -d'=' -f1
}

# env_append <env_file> <name> <value>
env_append() {
  local file="$1"
  local name="$2"
  local value="$3"
  if [[ ! -f "$file" ]]; then
    touch "$file"
    chmod 600 "$file"
  fi
  echo "${name}=${value}" >> "$file"
}

# write_secret_file <name> <value>
write_secret_file() {
  local name="$1"
  local value="$2"
  mkdir -p "$SECRETS_DIR"
  local filename
  filename=$(echo "$name" | tr '[:upper:]' '[:lower:]').txt
  local path="${SECRETS_DIR}/${filename}"
  printf '%s' "$value" > "$path"
  chmod 600 "$path"
}

# ---- Deploy-state helpers ----

# deploy_state_init: ensure the file exists with a header comment.
# If absent and .env exists, seed from .env names (one-time migration for
# instances that pre-date bin/deploy.sh).
deploy_state_init() {
  if [[ -f "$DEPLOY_STATE_FILE" ]]; then
    return 0
  fi
  log_info "Creating ${DEPLOY_STATE_FILE}..."
  {
    echo "# Pavillion deploy state — managed by bin/deploy.sh"
    echo "# Do not edit by hand. Lists secrets ever provisioned on this instance."
  } > "$DEPLOY_STATE_FILE"
  chmod 600 "$DEPLOY_STATE_FILE"
  if [[ -f "$ENV_FILE" ]]; then
    local seeded=0
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      echo "$name" >> "$DEPLOY_STATE_FILE"
      seeded=$((seeded+1))
    done < <(env_names "$ENV_FILE")
    if (( seeded > 0 )); then
      log_info "Seeded ${seeded} existing secret name(s) from .env into .deploy-state."
    fi
  fi
}

# deploy_state_has <name> -> exit 0 if name is recorded
deploy_state_has() {
  local name="$1"
  [[ -f "$DEPLOY_STATE_FILE" ]] || return 1
  grep -qxE "${name}" "$DEPLOY_STATE_FILE"
}

# deploy_state_record <name>
deploy_state_record() {
  local name="$1"
  if ! deploy_state_has "$name"; then
    echo "$name" >> "$DEPLOY_STATE_FILE"
  fi
}

# ---- Manifest diff ----

# missing_secrets -> stdout: one NAME|STABILITY per line for each manifest
# entry whose NAME is not set in .env.
missing_secrets() {
  while IFS='|' read -r name generator stability description; do
    [[ -z "$name" ]] && continue
    if ! env_has "$ENV_FILE" "$name"; then
      echo "${name}|${stability}"
    fi
  done < <(parse_manifest "$MANIFEST")
}

# provision_secret <name> <generator> — generate a value, write to .env +
# secrets/, and record the name in .deploy-state.
provision_secret() {
  local name="$1"
  local generator="$2"
  local value
  value=$(generate_secret "$generator")
  env_append "$ENV_FILE" "$name" "$value"
  write_secret_file "$name" "$value"
  deploy_state_record "$name"
}

# resolve_missing: handle each missing secret per the deploy-state-aware
# rubric. Returns 0 on success, 2 if a 'stable' previously-provisioned
# secret is missing in non-interactive mode.
resolve_missing() {
  deploy_state_init

  local failures=0
  while IFS='|' read -r name stability; do
    [[ -z "$name" ]] && continue
    local generator
    generator=$(manifest_field "$MANIFEST" "$name" "generator")
    local description
    description=$(manifest_field "$MANIFEST" "$name" "description")

    # Case 1: name is NOT in .deploy-state — newly-introduced secret.
    # Auto-generate regardless of stability.
    if ! deploy_state_has "$name"; then
      log_info "Generating ${name} (newly-introduced this version)..."
      provision_secret "$name" "$generator"
      log_success "Generated ${name}"
      continue
    fi

    # Case 2: name IS in .deploy-state — previously-provisioned. Apply the
    # stability rubric.
    case "$stability" in
      regenerable)
        log_warn "Regenerating ${name} (previously provisioned, but missing from .env)..."
        provision_secret "$name" "$generator"
        log_success "Regenerated ${name}"
        ;;
      stable)
        if [[ $NON_INTERACTIVE -eq 1 ]]; then
          log_error "Required secret ${name} was previously provisioned but is missing from .env."
          log_error "  ${description}"
          log_error "  Restore the value from your password manager and add ${name}=<value> to ${ENV_FILE},"
          log_error "  or re-run interactively to choose between paste and regenerate."
          failures=$((failures+1))
        else
          echo ""
          echo "${C_YELLOW}${C_BOLD}Secret ${name} was previously provisioned, but is missing from .env.${C_RESET}"
          echo "  ${description}"
          echo ""
          echo "Options:"
          echo "  1. Paste the existing value (from your password manager)"
          echo "  2. Type GENERATE to accept the documented impact and create a new one"
          echo "  3. Press Ctrl-C to abort"
          echo ""
          read -r -p "Value or GENERATE: " response
          local value
          if [[ "$response" == "GENERATE" ]]; then
            value=$(generate_secret "$generator")
            log_success "Generated new ${name}"
          elif [[ -z "$response" ]]; then
            log_error "Empty response. Aborting."
            failures=$((failures+1))
            continue
          else
            value="$response"
          fi
          env_append "$ENV_FILE" "$name" "$value"
          write_secret_file "$name" "$value"
          deploy_state_record "$name"
        fi
        ;;
      *)
        log_error "unknown stability '${stability}' for ${name}"
        failures=$((failures+1))
        ;;
    esac
  done < <(missing_secrets)

  if [[ $failures -gt 0 ]]; then
    return 2
  fi
  return 0
}

main() {
  parse_args "$@"

  if [[ $DEBUG_DIFF -eq 1 ]]; then
    missing_secrets
    exit 0
  fi
  if [[ -n "$DEBUG_GENERATE" ]]; then
    generate_secret "$DEBUG_GENERATE"
    exit 0
  fi
  if [[ $DEBUG_RESOLVE -eq 1 ]]; then
    resolve_missing
    exit $?
  fi

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  # Subsequent tasks fill in install/upgrade flow.
  log_info "Scaffold-only: nothing to do yet."
}

main "$@"
