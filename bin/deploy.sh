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
# Settings:
#   .env is parsed line by line, never sourced or evaled: a value is the
#   text after NAME= on the last line naming it, with one pair of matching
#   quotes removed. The script only ever appends to .env; it never edits a
#   line in place. A setting resolves as Compose resolves it: the shell
#   environment first (an exported empty value falls to the default), then
#   .env, then the default.
#
# Exit codes:
#   0  success (including "nothing to do")
#   1  generic failure
#   2  missing 'stable' secret in non-interactive mode
#   3  safety check failed (dirty tree, wrong directory,
#      PAVILLION_IMAGE_TAG=previous, etc.)
#   4  docker compose up succeeded but /health never returned 200
#
# Application images:
#   Before pulling, the image the app container runs is noted; if the pull
#   brings a different one, the running image is tagged
#   <repository>:previous for rollback. After a healthy upgrade, images of
#   the application repository that no container uses and that are neither
#   :previous nor the configured tag are removed. Nothing is removed after
#   a failed pull, a failed start or a failed health check.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
source "${SCRIPT_DIR}/lib/manifest.sh"

# Defaults. No script-level variable may be named after a setting Compose
# reads (DOMAIN, APP_PORT, COMPOSE_PROFILES, BACKUP_HOST_DIR): an operator's
# exported value must reach docker compose unchanged. Read those through
# resolve_setting.
NON_INTERACTIVE=0
SKIP_GIT_PULL=0
DOMAIN_ARG=""
HEALTH_TIMEOUT=120
MANIFEST="${REPO_ROOT}/bin/deploy-manifest.tsv"
ENV_FILE="${REPO_ROOT}/.env"
SECRETS_DIR="${REPO_ROOT}/secrets"
DEPLOY_STATE_FILE="${REPO_ROOT}/.deploy-state"

# Application image retention (see "Application images" above).
ROLLBACK_TAG="previous"
DISK_ALERT_GUIDE_URL="https://docs.pavillion.social/guides/instance-administrators/monitoring-and-logs#when-the-disk-alert-arrives"
APP_REPOSITORY=""
APP_IMAGE_REF=""
RUNNING_APP_IMAGE_ID=""

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
      --domain=*)        DOMAIN_ARG="${arg#*=}" ;;
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

# env_append <env_file> <name> <value> — the only writer of .env. Appends,
# creating a missing file with mode 600, and never edits a line in place. A
# hand-edited file whose last line has no newline gets one first, so the new
# assignment does not merge into that line.
env_append() {
  local file="$1"
  local name="$2"
  local value="$3"
  if [[ ! -f "$file" ]]; then
    touch "$file"
    chmod 600 "$file"
  fi
  if [[ -s "$file" && -n "$(tail -c1 "$file")" ]]; then
    echo "" >> "$file"
  fi
  echo "${name}=${value}" >> "$file"
}

# unquote_value <raw> -> stdout: <raw> trimmed of surrounding whitespace with
# one pair of matching surrounding quotes removed. A whitespace-led '#'
# comment after the value is dropped, as Compose drops one from .env.
unquote_value() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  local quote="${value:0:1}"
  if [[ "$quote" == '"' || "$quote" == "'" ]]; then
    local rest="${value:1}"
    if [[ "$rest" == *"$quote"* ]]; then
      local after="${rest#*"$quote"}"
      after="${after#"${after%%[![:space:]]*}"}"
      if [[ -z "$after" || "$after" == "#"* ]]; then
        printf '%s\n' "${rest%%"$quote"*}"
        return 0
      fi
    fi
  fi
  value="${value%%[[:space:]]#*}"
  value="${value%"${value##*[![:space:]]}"}"
  printf '%s\n' "$value"
}

# env_get <env_file> <name> -> stdout: the value on the last NAME= line, or
# nothing. Parsed, never sourced or evaled. Use ! env_has to test "absent".
env_get() {
  local file="$1"
  local name="$2"
  [[ -f "$file" ]] || return 0
  local line
  line=$(grep -E "^${name}=" "$file" | tail -n1 || true)
  [[ -n "$line" ]] || return 0
  unquote_value "$(printf '%s' "$line" | cut -d= -f2-)"
}

# resolve_setting <name> <default> -> stdout: the setting as Compose resolves
# it — the shell environment, then .env, then <default>. printenv sees only
# exported variables and tells unset from empty; a variable exported empty
# wins over .env and then falls to <default>, as it does in Compose.
resolve_setting() {
  local name="$1"
  local default="$2"
  local value
  if value=$(printenv "$name"); then
    printf '%s\n' "${value:-$default}"
  elif env_has "$ENV_FILE" "$name"; then
    env_get "$ENV_FILE" "$name"
  else
    printf '%s\n' "$default"
  fi
}

# standalone_active -> exit 0 if the resolved COMPOSE_PROFILES, split on
# commas, contains exactly 'standalone'.
standalone_active() {
  local profiles
  profiles=$(resolve_setting COMPOSE_PROFILES "")
  [[ -n "$profiles" ]] || return 1
  local -a names
  IFS=',' read -r -a names <<< "$profiles"
  local profile
  for profile in "${names[@]}"; do
    [[ "$profile" == "standalone" ]] && return 0
  done
  return 1
}

# local_yaml_domain -> stdout: the top-level domain: of config/local.yaml with
# quotes stripped, or nothing if the file or key is absent. Indented keys
# never match.
local_yaml_domain() {
  local file="${REPO_ROOT}/config/local.yaml"
  [[ -f "$file" ]] || return 0
  local line
  line=$(grep -E '^domain:' "$file" | tail -n1 || true)
  [[ -n "$line" ]] || return 0
  unquote_value "${line#domain:}"
}

# ---- Validation ----
# Each validator reports pass (0) or fail (1) and prints nothing; the caller
# decides whether a failure is fatal and what to log.

# validate_domain <value>: lowercase RFC 1123 hostname. Labels of a-z, 0-9
# and '-', 1-63 characters, neither starting nor ending with '-', joined by
# dots, 253 characters at most. No trailing dot, scheme, port, path,
# userinfo or whitespace, and not all-numeric (an IPv4-shaped name cannot
# get an ACME hostname certificate). Character classes are spelled out so
# the locale cannot widen them.
validate_domain() {
  local value="$1"
  local chars='abcdefghijklmnopqrstuvwxyz0123456789'
  local label_re="^[${chars}]([${chars}-]{0,61}[${chars}])?\$"
  local numeric_re='^[0123456789.]+$'
  [[ -n "$value" && ${#value} -le 253 ]] || return 1
  [[ "$value" =~ $numeric_re ]] && return 1
  local rest="$value"
  local label
  while :; do
    label="${rest%%.*}"
    [[ "$label" =~ $label_re ]] || return 1
    [[ "$rest" == *.* ]] || return 0
    rest="${rest#*.}"
  done
}

# validate_app_port <value>: a bare port or address:port, as APP_PORT is
# published by docker-compose.yml.
validate_app_port() {
  local port_re='^([0123456789.]+:)?[0123456789]+$'
  [[ "$1" =~ $port_re ]]
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

# prompt_domain: emit the desired domain on stdout. If DOMAIN_ARG is set
# (via --domain=), use it. Otherwise prompt interactively, or fail in
# non-interactive mode.
prompt_domain() {
  if [[ -n "$DOMAIN_ARG" ]]; then
    echo "$DOMAIN_ARG"
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
    log_error "If the disk is full, see ${DISK_ALERT_GUIDE_URL}"
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

# poll_health <timeout_seconds>: poll the app's /health on the address
# docker-compose.yml publishes it at until curl returns success or the timeout
# expires. APP_PORT may be a bare port (polled on localhost) or host:port
# (polled on that host); unset, it matches the compose default of
# 127.0.0.1:3000. Returns 0 on success, 4 on timeout.
poll_health() {
  local timeout="$1"
  local bind="${APP_PORT:-127.0.0.1:3000}"
  local host="localhost"
  local port="$bind"
  if [[ "$bind" == *:* ]]; then
    host="${bind%:*}"
    port="${bind##*:}"
  fi
  local url="http://${host}:${port}/health"
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

# ---- Application image retention ----
#
# Removal is scoped to the application repository: other repositories, the
# sidecar images, volumes and stopped containers' images are never touched,
# no command is forced, and every image is compared by its full sha256: id.
# Functions whose stdout is data log nothing; their callers do the logging.

HEX_DIGITS='abcdef0123456789'

# validate_image_id <value>: a full sha256: image id.
validate_image_id() {
  local id_re="^sha256:[${HEX_DIGITS}]{64}\$"
  [[ "$1" =~ $id_re ]]
}

# validate_object_id <value>: an id as Docker lists it — short or full,
# with or without the sha256: prefix. Guards what is passed back to docker.
validate_object_id() {
  local id_re="^(sha256:)?[${HEX_DIGITS}]{12,64}\$"
  [[ "$1" =~ $id_re ]]
}

# validate_repository <value>: a lowercase repository name, registry port
# allowed. Rejects empty, multi-line and whitespace values.
validate_repository() {
  local repo_re='^[abcdefghijklmnopqrstuvwxyz0123456789][abcdefghijklmnopqrstuvwxyz0123456789._/:-]*$'
  [[ "$1" =~ $repo_re ]]
}

# validate_image_tag <value>: Docker's tag grammar. '<none>' fails it.
validate_image_tag() {
  local tag_re='^[ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_][ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-]{0,127}$'
  [[ "$1" =~ $tag_re ]]
}

# image_ref_repository <ref> -> stdout: <ref> without its digest and tag.
# The tag is split at the last ':' after the last '/', so a registry port
# stays part of the repository.
image_ref_repository() {
  local ref="${1%%@*}"
  if [[ "${ref##*/}" == *:* ]]; then
    printf '%s\n' "${ref%:*}"
  else
    printf '%s\n' "$ref"
  fi
}

# ref_in_repository <ref> <repository>: exit 0 if <ref> is a tag or digest
# reference of exactly <repository> (not of a longer name sharing its prefix).
ref_in_repository() {
  local ref="$1"
  local repo="$2"
  [[ "$ref" == "${repo}:"* || "$ref" == "${repo}@"* ]] || return 1
  local rest="${ref:${#repo}+1}"
  [[ -n "$rest" && "$rest" != */* ]]
}

# resolve_image_id <ref> -> stdout: the full sha256: id <ref> names.
# Fails if docker cannot inspect it or reports an id of another form.
resolve_image_id() {
  local ref="$1"
  [[ -n "$ref" && "$ref" != -* ]] || return 1
  local id
  id=$(docker image inspect --format '{{.Id}}' "$ref") || return 1
  validate_image_id "$id" || return 1
  printf '%s\n' "$id"
}

# image_refs <id> -> stdout: the image's RepoTags and RepoDigests, one per
# line, read from docker's JSON arrays.
image_refs() {
  local out
  out=$(docker image inspect --format '{{json .RepoTags}} {{json .RepoDigests}}' "$1") || return 1
  parse_ref_arrays "$out"
}

# parse_ref_arrays <text> -> stdout: the entries of the JSON string arrays
# in <text>, one per line. References contain no quotes, commas or spaces.
parse_ref_arrays() {
  local entry
  while IFS= read -r entry; do
    [[ -n "$entry" && "$entry" != "null" ]] && printf '%s\n' "$entry"
  done < <(printf '%s\n' "$1" | tr -d '[]"' | tr ', ' '\n\n')
  return 0
}

# refs_in_repository <refs> <repository>: exit 0 if any line of <refs>
# belongs to <repository>.
refs_in_repository() {
  local ref
  while IFS= read -r ref; do
    [[ -n "$ref" ]] && ref_in_repository "$ref" "$2" && return 0
  done <<< "$1"
  return 1
}

# refs_outside_repository <refs> <repository>: exit 0 if any line of <refs>
# belongs to another repository.
refs_outside_repository() {
  local ref
  while IFS= read -r ref; do
    [[ -n "$ref" ]] && ! ref_in_repository "$ref" "$2" && return 0
  done <<< "$1"
  return 1
}

# format_bytes <bytes> -> stdout: a decimal size such as "1.2 GB".
format_bytes() {
  awk -v b="$1" 'BEGIN {
    split("B KB MB GB TB", unit, " "); i = 1
    while (b >= 1000 && i < 5) { b /= 1000; i++ }
    if (i == 1) printf "%d %s\n", b, unit[i]; else printf "%.1f %s\n", b, unit[i]
  }'
}

# refuse_rollback_image_tag: exit 3 when PAVILLION_IMAGE_TAG (shell or .env)
# is the local rollback tag. That tag exists only on this host, so a pull
# for it would fail, and cleanup must not run against it.
refuse_rollback_image_tag() {
  [[ "$(resolve_setting PAVILLION_IMAGE_TAG "")" == "$ROLLBACK_TAG" ]] || return 0
  log_error "PAVILLION_IMAGE_TAG is set to '${ROLLBACK_TAG}': this instance is running its local rollback image."
  log_error "  To resume upgrades, remove PAVILLION_IMAGE_TAG from ${ENV_FILE} and the shell, or set it to"
  log_error "  the version to upgrade to, then re-run bin/deploy.sh."
  return 3
}

# app_image_context: read the running app container's image id, the
# application repository and the configured app image reference into
# RUNNING_APP_IMAGE_ID, APP_REPOSITORY and APP_IMAGE_REF. Exit 1 (after
# logging why) when any is unavailable; the deploy then tags and removes
# nothing. `docker compose config --images app` also lists the images of
# app's dependencies, so the configured reference is the one line naming the
# repository the running container was created from.
app_image_context() {
  RUNNING_APP_IMAGE_ID=""; APP_REPOSITORY=""; APP_IMAGE_REF=""
  local container
  if ! container=$(cd "$REPO_ROOT" && docker compose ps -q app); then
    log_warn "Could not list the app container; old application images will not be removed."
    return 1
  fi
  container="${container%%$'\n'*}"
  if [[ -z "$container" ]]; then
    log_info "No running app container: no rollback image is tagged and no images are removed."
    return 1
  fi
  local fields
  if ! validate_object_id "$container" \
    || ! fields=$(docker inspect --format '{{.Image}} {{.Config.Image}}' "$container"); then
    log_warn "Could not inspect the app container; old application images will not be removed."
    return 1
  fi
  local running_id
  if ! running_id=$(resolve_image_id "${fields%% *}"); then
    log_warn "Could not read the running application image id; old application images will not be removed."
    return 1
  fi
  local repository
  repository=$(image_ref_repository "${fields#* }")
  if ! validate_repository "$repository"; then
    log_warn "The application repository is not a valid name; old application images will not be removed."
    return 1
  fi
  local images
  if ! images=$(cd "$REPO_ROOT" && docker compose config --images app); then
    log_warn "Could not read the configured app image; old application images will not be removed."
    return 1
  fi
  local ref matches=""
  while IFS= read -r ref; do
    [[ -n "$ref" && "$(image_ref_repository "$ref")" == "$repository" ]] || continue
    [[ $'\n'"$matches" == *$'\n'"${ref}"$'\n'* ]] || matches="${matches}${ref}"$'\n'
  done <<< "$images"
  matches="${matches%$'\n'}"
  if [[ -z "$matches" || "$matches" == *$'\n'* || "$matches" == *[[:space:]]* ]]; then
    log_warn "The configured app image is not one ${repository} reference; old application images will not be removed."
    return 1
  fi
  RUNNING_APP_IMAGE_ID="$running_id"
  APP_REPOSITORY="$repository"
  APP_IMAGE_REF="$matches"
  return 0
}

# tag_rollback_image: after the pull, tag the image the app was running as
# <repository>:previous if the configured reference now names another image.
# With no new image, :previous stays where it was. Exit 1 when cleanup would
# be unsafe this run (the configured image or the tag step failed).
tag_rollback_image() {
  local configured_id
  if ! configured_id=$(resolve_image_id "$APP_IMAGE_REF"); then
    log_warn "Could not read the image ${APP_IMAGE_REF} names; old application images will not be removed."
    return 1
  fi
  if [[ "$configured_id" == "$RUNNING_APP_IMAGE_ID" ]]; then
    log_info "No new application image; ${APP_REPOSITORY}:${ROLLBACK_TAG} is unchanged."
    return 0
  fi
  local refs
  if ! refs=$(image_refs "$RUNNING_APP_IMAGE_ID"); then
    log_warn "Could not inspect the running application image; old application images will not be removed."
    return 1
  fi
  if ! refs_in_repository "$refs" "$APP_REPOSITORY"; then
    log_warn "The running application image has no ${APP_REPOSITORY} tag or digest; not tagging it ${ROLLBACK_TAG}."
    return 0
  fi
  if ! docker tag "$RUNNING_APP_IMAGE_ID" "${APP_REPOSITORY}:${ROLLBACK_TAG}"; then
    log_warn "Could not tag the running image ${ROLLBACK_TAG}; old application images will not be removed."
    return 1
  fi
  log_info "Kept the running application image as ${APP_REPOSITORY}:${ROLLBACK_TAG} for rollback."
  return 0
}

# list_app_images -> stdout: one "<full id> <tag>" line per row of
# `docker image ls <repository>` (the tag may be <none>). Fails if the
# listing fails or any row's id is not a sha256: id.
list_app_images() {
  local rows
  rows=$(docker image ls "$APP_REPOSITORY" --format '{{.ID}} {{.Tag}}') || return 1
  local short tag id
  while read -r short tag <&3; do
    [[ -n "$short" ]] || continue
    validate_object_id "$short" || return 1
    id=$(resolve_image_id "$short") || return 1
    printf '%s %s\n' "$id" "$tag"
  done 3<<< "$rows"
}

# build_keep_set <listing> -> stdout: the full ids cleanup must keep — every
# container's image (running or stopped), the image behind :previous and
# the image behind the configured reference. Fails if any lookup fails: a
# partial keep set is how a rollback or in-use image would be deleted.
build_keep_set() {
  local listing="$1"
  local containers
  containers=$(docker ps -a -q --no-trunc) || return 1
  local -a ids=()
  local line
  while IFS= read -r line; do
    [[ -n "$line" ]] || continue
    validate_object_id "$line" || return 1
    ids+=("$line")
  done <<< "$containers"
  if (( ${#ids[@]} > 0 )); then
    local images
    images=$(docker inspect --format '{{.Image}}' "${ids[@]}") || return 1
    while IFS= read -r line <&3; do
      [[ -n "$line" ]] || continue
      resolve_image_id "$line" || return 1
    done 3<<< "$images"
  fi
  local id tag
  while read -r id tag; do
    if [[ "$tag" == "$ROLLBACK_TAG" ]]; then
      printf '%s\n' "$id"
    fi
  done <<< "$listing"
  resolve_image_id "$APP_IMAGE_REF" || return 1
}

# select_candidates <listing> <keep> -> stdout: each listed id not in
# <keep>, once.
select_candidates() {
  local listing="$1"
  local keep="$2"
  local seen=""
  local id tag
  while read -r id tag; do
    [[ -n "$id" ]] || continue
    printf '%s\n' "$keep" | grep -Fqx -- "$id" && continue
    [[ "$seen" == *"$id"* ]] && continue
    seen="${seen} ${id}"
    printf '%s\n' "$id"
  done <<< "$listing"
}

# remove_app_image <id> <listing>: untag the image's application tags by
# reference, then — unless another repository still references it — remove
# it by id. Sets REMOVED_IMAGE_SIZE to its size before removal (0 when
# unknown). Exit 0 only when the image is gone.
remove_app_image() {
  local id="$1"
  local listing="$2"
  REMOVED_IMAGE_SIZE=0
  local info
  if ! info=$(docker image inspect --format '{{.Size}} {{json .RepoTags}} {{json .RepoDigests}}' "$id"); then
    log_warn "Could not inspect ${id}; keeping it."
    return 1
  fi
  local size="${info%% *}"
  [[ "$size" =~ ^[0123456789]+$ ]] || size=0
  local refs
  refs=$(parse_ref_arrays "${info#* }")

  local row_id tag
  while read -r row_id tag <&3; do
    [[ "$row_id" == "$id" && "$tag" != "<none>" ]] || continue
    if ! validate_image_tag "$tag" || [[ "$tag" == "$ROLLBACK_TAG" ]]; then
      log_warn "Skipping a tag of ${id} that is not a valid Docker tag."
      continue
    fi
    if ! docker image rm "${APP_REPOSITORY}:${tag}" >/dev/null; then
      log_warn "Could not remove ${APP_REPOSITORY}:${tag}; keeping ${id}."
      return 1
    fi
  done 3<<< "$listing"

  if refs_outside_repository "$refs" "$APP_REPOSITORY"; then
    log_info "${id} is also referenced by another repository; removed only its ${APP_REPOSITORY} tags."
    return 1
  fi
  # Untagging the last tag already removes an image Docker no longer needs.
  if docker image inspect --format '{{.Id}}' "$id" >/dev/null 2>&1; then
    if ! docker image rm "$id" >/dev/null; then
      log_warn "Could not remove ${id}; keeping it."
      return 1
    fi
  fi
  REMOVED_IMAGE_SIZE="$size"
  return 0
}

# prune_app_images: after a healthy upgrade, remove application images that
# no container uses and that are neither :previous nor the configured image.
# Always returns 0: cleanup never fails a deploy.
prune_app_images() {
  local listing keep candidates
  if ! listing=$(list_app_images); then
    log_warn "Could not list ${APP_REPOSITORY} images; no images removed."
    return 0
  fi
  if ! keep=$(build_keep_set "$listing"); then
    log_warn "Could not tell which images are in use; no images removed."
    return 0
  fi
  if ! candidates=$(select_candidates "$listing" "$keep"); then
    log_warn "Could not select old application images; no images removed."
    return 0
  fi
  local removed=0
  local reclaimed=0
  local id
  while IFS= read -r id <&3; do
    [[ -n "$id" ]] || continue
    if remove_app_image "$id" "$listing"; then
      removed=$((removed + 1))
      reclaimed=$((reclaimed + REMOVED_IMAGE_SIZE))
    fi
  done 3<<< "$candidates"
  log_info "Removed ${removed} old application images, reclaimed $(format_bytes "$reclaimed")"
  return 0
}

# run_docker: pull, tag the replaced image for rollback, up, poll /health,
# and only after a healthy start remove old application images.
run_docker() {
  refuse_rollback_image_tag || return $?
  local cleanup=0
  if app_image_context; then
    cleanup=1
  fi
  run_docker_pull || return 1
  if (( cleanup )) && ! tag_rollback_image; then
    cleanup=0
  fi
  run_docker_up || return 1
  poll_health "$HEALTH_TIMEOUT" || return $?
  if (( cleanup )); then
    prune_app_images
  fi
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

# Run main only when executed, not when sourced — bin/test/deploy_test.sh
# sources this file to table-test the helpers.
if [[ "${BASH_SOURCE[0]:-$0}" == "$0" ]]; then
  main "$@"
fi
