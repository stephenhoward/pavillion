#!/usr/bin/env bash
# Tests for bin/pavillion, the production CLI launcher.
#
# The real launcher is copied into a temp tree that mirrors the app layout
# (bin/, src/server/cli/index.ts, package.json with "type": "module") with a
# stub standing in for node_modules/.bin/tsx. The stub records its argv, cwd
# and DB_PASSWORD so each check can assert one behaviour of the launcher.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

REPO="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# ── Fixture tree ────────────────────────────────────────────────────────────
APP="$(mktemp_dir)"
APP_REAL="$(cd "${APP}" && pwd -P)"
mkdir -p "${APP}/bin" "${APP}/src/server/cli" "${APP}/node_modules/.bin"
cp "${REPO}/bin/pavillion" "${APP}/bin/pavillion"
printf '{ "type": "module" }\n' > "${APP}/package.json"
: > "${APP}/src/server/cli/index.ts"

TSX="${APP}/node_modules/.bin/tsx"
cat > "${TSX}" <<'STUB'
#!/bin/sh
case "${STUB_MODE:-}" in
  signal) kill -TERM $$ ;;
  exit) exit "${STUB_EXIT}" ;;
esac
{
  printf 'cwd=%s\n' "$(pwd -P)"
  for a in "$@"; do printf 'arg=%s\n' "$a"; done
  printf 'pw=[%s]\n' "${DB_PASSWORD:-}"
} > "${STUB_OUT}"
STUB
chmod +x "${TSX}"

# Every run starts from a directory that is not the app root.
ELSEWHERE="$(mktemp_dir)"
OUT="${ELSEWHERE}/stub.out"

run_launcher() {
  # run_launcher <args...> — run from ELSEWHERE; sets RC and ERR.
  rm -f "${OUT}"
  ERR="$(cd "${ELSEWHERE}" && STUB_OUT="${OUT}" node "${APP}/bin/pavillion" "$@" 2>&1 >/dev/null)"
  RC=$?
}

# ── Arguments and cwd ───────────────────────────────────────────────────────
echo "argument passing"
META='a b; echo $(id)'
run_launcher backup "${META}"
assert_contains "$(cat "${OUT}" 2>/dev/null)" "arg=${META}" \
  "an argument holding a space and metacharacters arrives literally"

echo "working directory"
run_launcher status
assert_contains "$(cat "${OUT}" 2>/dev/null)" "cwd=${APP_REAL}" \
  "the child's cwd is the app root"

# ── Exit status ─────────────────────────────────────────────────────────────
echo "exit status"
STUB_MODE=exit STUB_EXIT=7 run_launcher status
assert_exit_code 7 "${RC}" "a non-zero child exit passes through"

STUB_MODE=signal run_launcher status
assert_exit_code 1 "${RC}" "a child killed by a signal gives exit 1"

# ── Missing tsx ─────────────────────────────────────────────────────────────
echo "missing tsx"
mv "${TSX}" "${TSX}.away"
DECOY_DIR="$(mktemp_dir)"
DECOY_MARK="${DECOY_DIR}/decoy-ran"
printf '#!/bin/sh\ntouch "%s"\n' "${DECOY_MARK}" > "${DECOY_DIR}/tsx"
chmod +x "${DECOY_DIR}/tsx"
PATH="${DECOY_DIR}:${PATH}" DB_PASSWORD=env-secret-value run_launcher status arg-secret-value
[[ "${RC}" -ne 0 ]] && missing_rc=nonzero || missing_rc=zero
assert_eq nonzero "${missing_rc}" "a missing tsx gives a non-zero exit"
assert_contains "${ERR}" "node_modules/.bin/tsx" "a missing tsx reports an error on stderr"
[[ -e "${DECOY_MARK}" ]] && decoy=ran || decoy=not-run
assert_eq not-run "${decoy}" "no tsx from PATH runs"
[[ "${ERR}" == *arg-secret-value* || "${ERR}" == *env-secret-value* ]] && leaked=yes || leaked=no
assert_eq no "${leaked}" "the error prints no argument or env value"
mv "${TSX}.away" "${TSX}"

# ── *_FILE secrets ──────────────────────────────────────────────────────────
echo "*_FILE secrets"
SECRET="${ELSEWHERE}/db_password"
printf 'file-secret\n\n' > "${SECRET}"

DB_PASSWORD='' DB_PASSWORD_FILE="${SECRET}" run_launcher status
assert_contains "$(cat "${OUT}" 2>/dev/null)" "pw=[file-secret]" \
  "the child sees the file value with trailing newlines removed"

DB_PASSWORD=env-value DB_PASSWORD_FILE="${SECRET}" run_launcher status
assert_contains "$(cat "${OUT}" 2>/dev/null)" "pw=[file-secret]" \
  "the file wins over a set DB_PASSWORD"

MISSING="${ELSEWHERE}/no-such-secret"
DB_PASSWORD_FILE="${MISSING}" run_launcher status
assert_contains "${ERR}" "DB_PASSWORD_FILE" "a missing file warns naming the variable"
[[ "${ERR}" == *"${MISSING}"* ]] && printed=yes || printed=no
assert_eq no "${printed}" "the missing-file warning prints no value"
[[ -f "${OUT}" ]] && ran=yes || ran=no
assert_eq yes "${ran}" "the child still runs after a missing-file warning"

report_results
