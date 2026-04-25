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

main() {
  parse_args "$@"

  local mode
  mode=$(detect_mode)
  log_info "Detected mode: ${mode}"

  # Subsequent tasks fill in the real behavior. For now, scaffold only.
  log_info "Scaffold-only: nothing to do yet."
}

main "$@"
