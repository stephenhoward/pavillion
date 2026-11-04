#!/usr/bin/env bash
# Unit tests for bin/provision.sh.
#
# Provisioning only runs as root on a fresh server, so nothing here executes a
# real step. The script is sourced (its main() is guarded), every step that
# touches the host is replaced by a no-op, `su` runs the deploy command in the
# current user's shell, and bin/deploy.sh is a stub in a temp APP_DIR. What is
# left to test is the part that decides the operator's next move: whether a
# failed deploy stops provisioning, and what the closing summary tells them.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

PROVISION="$(cd "${SCRIPT_DIR}/.." && pwd)/provision.sh"

assert_absent() {
  # assert_absent <haystack> <needle> <message>
  local haystack="$1"
  local needle="$2"
  local msg="${3:-assertion}"
  _TESTS=$((_TESTS+1))
  if [[ "$haystack" == *"$needle"* ]]; then
    echo "  FAIL: ${msg}"
    echo "    forbidden text is present: ${needle}"
    _FAILS=$((_FAILS+1))
  else
    echo "  PASS: ${msg}"
  fi
}

# Safety net: if a step this file does not stub ever reaches a privileged or
# networked command, it hits one of these and fails instead of touching the host.
STUB_BIN="$(mktemp_dir)"
for cmd in apt-get ufw systemctl useradd groupadd usermod sshd curl git docker openssl locale-gen update-locale; do
  printf '#!/bin/sh\necho "unexpected call: %s $*" >&2\nexit 99\n' "$cmd" > "${STUB_BIN}/${cmd}"
  chmod +x "${STUB_BIN}/${cmd}"
done

# run_provision <deploy_exit_code> <args...>
# Runs provision.sh's main() with every host step stubbed and a deploy.sh stub
# that exits with <deploy_exit_code>. Prints combined output then EXIT:<code>.
run_provision() {
  local deploy_exit="$1"
  shift
  local app_dir
  app_dir="$(mktemp_dir)"
  mkdir -p "${app_dir}/bin"
  printf '#!/bin/sh\necho "deploy stub ran"\nexit %s\n' "$deploy_exit" > "${app_dir}/bin/deploy.sh"
  chmod +x "${app_dir}/bin/deploy.sh"

  (
    PATH="${STUB_BIN}:${PATH}"
    # shellcheck source=../provision.sh
    source "${PROVISION}"
    APP_DIR="${app_dir}"
    preflight() { :; }
    configure_locale() { :; }
    create_deploy_user() { :; }
    harden_ssh() { :; }
    configure_firewall() { :; }
    install_docker() { :; }
    configure_docker_access() { :; }
    create_app_directory() { :; }
    install_webhook() { :; }
    clone_repo() { :; }
    create_runtime_directories() { :; }
    configure_staging() { :; }
    # su - <user> -c <command>
    su() { bash -c "$4"; }
    hostname() { echo "203.0.113.10"; }
    main "$@"
  ) 2>&1
  echo "EXIT:$?"
}

echo "provision_test.sh"

echo "test: a failed deploy.sh stops provisioning with a non-zero exit"
output=$(run_provision 1 --standalone --domain=events.example.org)
exit_code="${output##*EXIT:}"
assert_contains "$output" "deploy stub ran" "the deploy step ran"
if [[ "$exit_code" != "0" ]]; then
  echo "  PASS: provisioning exits non-zero (${exit_code})"
  _TESTS=$((_TESTS+1))
else
  fail "provisioning should exit non-zero when deploy.sh fails"
fi
assert_contains "$output" "Deploy had errors" "the deploy warning is printed"
assert_absent "$output" "Deploy script completed" "no deploy success line after a failed deploy"
assert_absent "$output" "Provisioning Complete" "no completion banner after a failed deploy"

echo "test: a successful deploy prints the next steps the guide gives"
output=$(run_provision 0 --standalone --domain=events.example.org)
exit_code="${output##*EXIT:}"
assert_eq "0" "$exit_code" "provisioning exits 0"
assert_contains "$output" "Provisioning Complete" "completion banner is printed"
assert_absent "$output" "docker compose up -d" "summary does not tell the operator to start the stack"
assert_contains "$output" "https://events.example.org" "summary names the instance URL"
assert_contains "$output" 'docker compose logs app | grep "Setup token"' "summary gives the guide's setup-token command"
assert_contains "$output" ".env" "summary lists .env for backup"
assert_contains "$output" "secrets/" "summary lists secrets/ for backup"
assert_contains "$output" "config/local.yaml" "summary lists config/local.yaml for backup"

echo "test: every apt-get call runs non-interactively"
apt_calls=$(grep -cE '^[^#]*apt-get ' "${PROVISION}")
noninteractive_calls=$(grep -cE '^[^#]*DEBIAN_FRONTEND=noninteractive apt-get ' "${PROVISION}")
if [[ "$apt_calls" -gt 0 ]]; then
  echo "  PASS: found ${apt_calls} apt-get calls"
  _TESTS=$((_TESTS+1))
else
  fail "no apt-get calls found; the check is not looking at the script"
fi
assert_eq "$apt_calls" "$noninteractive_calls" "every apt-get call sets DEBIAN_FRONTEND=noninteractive"

report_results
