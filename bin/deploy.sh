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
DEBUG_INSTALL=0
DEBUG_GIT_PULL=0
DEBUG_DOCKER=0

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
      --install-only)    DEBUG_INSTALL=1 ;;
      --git-pull-only)   DEBUG_GIT_PULL=1 ;;
      --docker-only)     DEBUG_DOCKER=1 ;;
      -h|--help)         print_help; exit 0 ;;
      *)
        log_error "unknown argument: ${arg}"
        echo "Run '$(basename "$0") --help' for usage." >&2
        exit 1
        ;;
    esac
  done

  # Non-TTY implies non-interactive even if flag not passed.
  # DEPLOY_FORCE_INTERACTIVE=1 disables the auto-flip so that tests can pipe
  # answers to the prompts; never set this in real deployments.
  if [[ ! -t 0 && "${DEPLOY_FORCE_INTERACTIVE:-0}" != "1" ]]; then
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
  # Read missing_secrets via fd 3 so that the interactive `read` below stays
  # bound to stdin (fd 0) — otherwise the prompt would silently consume from
  # the process substitution and the interactive recovery branch would never
  # reach the operator.
  while IFS='|' read -r name stability <&3; do
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
  done 3< <(missing_secrets)

  if [[ $failures -gt 0 ]]; then
    return 2
  fi
  return 0
}

# ---- Install-mode helpers ----

# prompt_domain: emit the desired domain on stdout. If DOMAIN is set
# (via --domain=), use it. Otherwise prompt interactively, or fail in
# non-interactive mode.
prompt_domain() {
  if [[ -n "$DOMAIN" ]]; then
    echo "$DOMAIN"
    return 0
  fi
  if [[ $NON_INTERACTIVE -eq 1 ]]; then
    log_error "Install mode requires --domain=<value> in non-interactive mode."
    return 1
  fi
  local response
  read -r -p "Enter your domain name (e.g., events.example.org): " response
  if [[ -z "$response" ]]; then
    log_error "Domain name is required."
    return 1
  fi
  echo "$response"
}

# write_local_yaml <domain>: copy config/local.yaml.example to
# config/local.yaml with the placeholder domain substituted. Leaves any
# existing config/local.yaml untouched (warns), and errors if the example
# file is missing.
write_local_yaml() {
  local domain="$1"
  local example="${REPO_ROOT}/config/local.yaml.example"
  local target="${REPO_ROOT}/config/local.yaml"

  if [[ -f "$target" ]]; then
    log_warn "config/local.yaml already exists. Leaving it untouched."
    return 0
  fi

  if [[ ! -f "$example" ]]; then
    log_error "config/local.yaml.example not found at ${example}"
    return 1
  fi

  # Substitute the placeholder domain. Use | as the sed delimiter to avoid
  # conflict with domains containing slashes.
  sed "s|pavillion.example.org|${domain}|g" "$example" > "$target"
  log_success "Created config/local.yaml with domain '${domain}'"
}

# run_install: first-install flow. Resolves all (missing) secrets, then
# prompts for the domain and writes config/local.yaml.
run_install() {
  log_info "First-install mode. Generating secrets, configuring local.yaml."

  # Resolve all secrets (on first install, all will be missing and generated).
  resolve_missing || return $?

  local domain
  if ! domain=$(prompt_domain); then
    return 1
  fi
  write_local_yaml "$domain" || return $?

  log_success "Install phase complete."
  return 0
}

# ---- Upgrade-mode helpers ----

# check_working_tree_clean: exit 0 if the repo is a git checkout with no
# uncommitted changes; non-zero otherwise.
check_working_tree_clean() {
  if ! git -C "$REPO_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    log_error "${REPO_ROOT} is not a git repository."
    return 1
  fi
  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    log_error "working tree is not clean. Commit or stash changes before upgrading:"
    git -C "$REPO_ROOT" status --short >&2
    return 1
  fi
  return 0
}

# run_git_pull: honor --skip-git-pull, otherwise verify a clean tree and
# fast-forward pull. Returns:
#   0 on success or skip
#   1 on git pull failure (e.g., not fast-forward)
#   3 on safety check failure (dirty tree, not a git repo)
run_git_pull() {
  if [[ $SKIP_GIT_PULL -eq 1 ]]; then
    log_info "Skipping git pull (--skip-git-pull)."
    return 0
  fi
  if ! check_working_tree_clean; then
    return 3
  fi
  log_info "Running git pull..."
  if ! git -C "$REPO_ROOT" pull --ff-only; then
    log_error "git pull failed. Resolve the conflict manually and re-run."
    return 1
  fi
  log_success "git pull complete."
  return 0
}

# ---- Docker-mode helpers ----

# run_docker_pull: fetch updated images.
run_docker_pull() {
  log_info "Pulling images..."
  if ! (cd "$REPO_ROOT" && docker compose pull); then
    log_error "docker compose pull failed."
    return 1
  fi
  log_success "Images pulled."
  return 0
}

# run_docker_up: bring containers up in detached mode.
run_docker_up() {
  log_info "Starting containers..."
  if ! (cd "$REPO_ROOT" && docker compose up -d --remove-orphans); then
    log_error "docker compose up failed."
    return 1
  fi
  log_success "Containers started."
  return 0
}

# poll_health <timeout_seconds>: poll http://localhost:${APP_PORT:-3000}/health
# until curl returns success or the timeout expires. Returns 0 on success,
# 4 on timeout.
poll_health() {
  local timeout="$1"
  local port="${APP_PORT:-3000}"
  local url="http://localhost:${port}/health"
  log_info "Polling ${url} for up to ${timeout}s..."

  local elapsed=0
  local interval=2
  while (( elapsed < timeout )); do
    if curl -sS -f -o /dev/null "${url}"; then
      log_success "Health check passed."
      return 0
    fi
    sleep "$interval"
    elapsed=$((elapsed + interval))
  done
  log_error "Health check timed out after ${timeout}s."
  log_error "Tail of 'docker compose logs app':"
  (cd "$REPO_ROOT" && docker compose logs --tail=50 app) || true
  return 4
}

# run_docker: pull, up, and poll /health.
run_docker() {
  run_docker_pull || return 1
  run_docker_up || return 1
  poll_health "$HEALTH_TIMEOUT" || return $?
  return 0
}

main() {
  parse_args "$@"

  # Debug dispatches (kept for testability).
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
  if [[ $DEBUG_INSTALL -eq 1 ]]; then
    run_install
    exit $?
  fi
  if [[ $DEBUG_GIT_PULL -eq 1 ]]; then
    run_git_pull
    exit $?
  fi
  if [[ $DEBUG_DOCKER -eq 1 ]]; then
    run_docker
    exit $?
  fi

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  if [[ "$mode" == "install" ]]; then
    run_install || exit $?
  else
    run_git_pull || exit $?
    resolve_missing || exit $?
  fi

  run_docker || exit $?

  log_success "Deploy complete."
}

main "$@"
