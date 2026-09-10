#!/usr/bin/env bash
# Unit tests for scripts/restore-drill.sh.
#
# The drill's Docker-dependent phases cannot run here — there is no Docker
# shell-test tier in this repo. What is covered is every decision the script
# makes in pure bash: which dump is newest, which migrations are expected,
# whether the applied-migration set matches, and whether the core tables are
# populated. The script is written so those functions are reachable by
# sourcing it, which does not run main().
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/lib.sh"

# Held separately: sourcing the drill below overwrites SCRIPT_DIR with its own.
TEST_DIR="${SCRIPT_DIR}"
REPO="$(cd "${TEST_DIR}/../.." && pwd)"
DRILL="${REPO}/scripts/restore-drill.sh"

# One work directory for the whole file. lib.sh's mktemp_dir registers its
# cleanup inside the command-substitution subshell, which deletes the directory
# before the caller can use it, so fixtures are built here instead.
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

echo "restore_drill_test.sh"

echo "test: the script parses"
if bash -n "${DRILL}"; then
  echo "  PASS: bash -n scripts/restore-drill.sh"
  _TESTS=$((_TESTS+1))
else
  fail "bash -n reported a syntax error"
fi

echo "test: the script is executable"
if [[ -x "${DRILL}" ]]; then
  echo "  PASS: scripts/restore-drill.sh has the executable bit"
  _TESTS=$((_TESTS+1))
else
  fail "scripts/restore-drill.sh is not executable"
fi

echo "test: the script never uses the destructive pg_restore -c flag"
if grep -q -- 'pg_restore .*-c ' "${DRILL}"; then
  fail "scripts/restore-drill.sh invokes pg_restore -c"
else
  echo "  PASS: no pg_restore -c"
  _TESTS=$((_TESTS+1))
fi

echo "test: the drill container is isolated and the backup mount is read-only"
run_block=$(grep -A 12 'docker run' "${DRILL}" | head -n 14)
assert_contains "$run_block" '--network none' "docker run uses --network none"
assert_contains "$run_block" '--rm' "docker run creates a self-removing container"
assert_contains "$(cat "${DRILL}")" 'docker rm --force --volumes' "cleanup removes the anonymous PGDATA volume too"
if grep -q ':/backup:ro' "${DRILL}"; then
  echo "  PASS: backup is mounted at /backup with an explicit :ro suffix"
  _TESTS=$((_TESTS+1))
else
  fail "backup mount is missing the :ro suffix"
fi

echo "test: no credential is interpolated onto a command line"
if grep -qE '(PGPASSWORD|POSTGRES_PASSWORD)=[^"]*\$' "${DRILL}"; then
  fail "a password value appears in an inline assignment on a command line"
else
  echo "  PASS: passwords are passed by name through the child environment"
  _TESTS=$((_TESTS+1))
fi

# Sourcing must not run the drill. If the entry guard is wrong this hangs or
# fails here rather than silently launching Docker.
source "${DRILL}"

echo "test: select_newest_backup picks the lexically-last dump"
listing=$(printf '%s\n' \
  'pavillion_20260101_010101_scheduled.dump' \
  'pavillion_20260315_235959_manual.dump' \
  'pavillion_20260214_120000_scheduled.dump')
out=$(select_newest_backup "${listing}")
assert_eq "pavillion_20260315_235959_manual.dump" "$out" "newest by timestamp-sortable filename"

echo "test: select_newest_backup ignores non-dump entries"
listing=$(printf '%s\n' \
  'README.md' \
  'pavillion_20260101_010101_scheduled.dump' \
  'pavillion_20260401_000000_manual.dump.tmp')
out=$(select_newest_backup "${listing}")
assert_eq "pavillion_20260101_010101_scheduled.dump" "$out" "only .dump files are candidates"

echo "test: select_newest_backup fails and names the reason on an empty listing"
err_out=$(select_newest_backup "" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "empty backup listing is a failure"
assert_contains "$err_out" "no backup files" "message names the missing-backups reason"

echo "test: select_newest_backup fails when the listing holds no .dump files"
err_out=$(select_newest_backup "notes.txt" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a listing without dumps is a failure"
assert_contains "$err_out" "no backup files" "message names the missing-backups reason"

echo "test: resolve_requested_backup accepts a file present in the listing"
listing=$(printf '%s\n' 'a.dump' 'b.dump')
out=$(resolve_requested_backup "${listing}" "a.dump")
assert_eq "a.dump" "$out" "explicit filename is honoured"

echo "test: resolve_requested_backup rejects a file absent from the listing"
err_out=$(resolve_requested_backup "${listing}" "missing.dump" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "unknown filename is a failure"
assert_contains "$err_out" "missing.dump" "message names the file that was not found"

echo "test: resolve_requested_backup rejects a path rather than a bare filename"
err_out=$(resolve_requested_backup "${listing}" "/opt/pavillion/backups/a.dump" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a host path is a failure"
assert_contains "$err_out" "filename" "message explains a bare filename is expected"

echo "test: resolve_requested_backup falls back to newest when no file is requested"
out=$(resolve_requested_backup "${listing}" "")
assert_eq "b.dump" "$out" "empty request selects the newest dump"

echo "test: list_expected_migrations reads .ts basenames and ignores README.md"
fixture="${WORK}/migrations"
mkdir -p "${fixture}"
touch "${fixture}/0002_second.ts" "${fixture}/0001_first.ts" "${fixture}/README.md"
out=$(list_expected_migrations "${fixture}")
expected=$(printf '%s\n' '0001_first.ts' '0002_second.ts')
assert_eq "$expected" "$out" "sorted .ts basenames only"

echo "test: list_expected_migrations fails on a directory with no migrations"
empty_dir="${WORK}/empty-migrations"
mkdir -p "${empty_dir}"
err_out=$(list_expected_migrations "${empty_dir}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "an empty migrations directory is a failure"
assert_contains "$err_out" "no migration files" "message names the missing migrations"

echo "test: list_expected_migrations fails on a missing directory"
err_out=$(list_expected_migrations "${empty_dir}/nope" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a missing migrations directory is a failure"
assert_contains "$err_out" "not found" "message names the missing directory"

echo "test: the repository's own migrations directory is readable and non-empty"
repo_migrations=$(list_expected_migrations "${REPO}/migrations")
repo_count=$(printf '%s\n' "${repo_migrations}" | grep -c '\.ts$')
if (( repo_count > 0 )); then
  echo "  PASS: counted ${repo_count} migrations at runtime (never hardcoded)"
  _TESTS=$((_TESTS+1))
else
  fail "expected at least one migration in migrations/"
fi
assert_contains "$repo_migrations" "0001_initial_schema.ts" "the initial migration is in the expected set"

echo "test: compare_migration_sets passes on identical sets"
set_a=$(printf '%s\n' '0001_a.ts' '0002_b.ts')
compare_migration_sets "${set_a}" "${set_a}" >/dev/null 2>&1
assert_exit_code "0" "$?" "equal sets compare clean"

echo "test: compare_migration_sets fails when the dump is missing a migration"
applied=$(printf '%s\n' '0001_a.ts')
err_out=$(compare_migration_sets "${set_a}" "${applied}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a dump predating the checkout fails"
assert_contains "$err_out" "migration mismatch" "message names the migration mismatch"
assert_contains "$err_out" "0002_b.ts" "message names the migration missing from the dump"

echo "test: compare_migration_sets fails when the dump carries an unknown migration"
applied=$(printf '%s\n' '0001_a.ts' '0002_b.ts' '0003_c.ts')
err_out=$(compare_migration_sets "${set_a}" "${applied}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a dump newer than the checkout fails (set equality)"
assert_contains "$err_out" "0003_c.ts" "message names the unexpected migration"

echo "test: compare_migration_sets fails when the dump applied nothing"
err_out=$(compare_migration_sets "${set_a}" "" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "an empty SequelizeMeta fails"
assert_contains "$err_out" "0001_a.ts" "message names every missing migration"

echo "test: evaluate_core_table_counts passes when every core table is populated"
counts=$(printf '%s\n' 'account|3' 'calendar|2' 'event|17')
evaluate_core_table_counts "${counts}" >/dev/null 2>&1
assert_exit_code "0" "$?" "populated core tables pass"

echo "test: evaluate_core_table_counts fails and names an empty table"
counts=$(printf '%s\n' 'account|0' 'calendar|2' 'event|17')
err_out=$(evaluate_core_table_counts "${counts}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "an empty core table is a failure"
assert_contains "$err_out" "account" "message names the empty table"

echo "test: evaluate_core_table_counts names every empty table, not just the first"
counts=$(printf '%s\n' 'account|0' 'calendar|0' 'event|4')
err_out=$(evaluate_core_table_counts "${counts}" 2>&1; echo "EXIT:$?")
assert_contains "$err_out" "account" "message names the first empty table"
assert_contains "$err_out" "calendar" "message names the second empty table"

echo "test: check_tables_present passes when every required table exists"
present=$(printf '%s\n' 'SequelizeMeta' 'account' 'calendar' 'event' 'media')
check_tables_present "${present}" >/dev/null 2>&1
assert_exit_code "0" "$?" "a complete schema passes"

echo "test: check_tables_present fails and names the missing table"
present=$(printf '%s\n' 'SequelizeMeta' 'account' 'calendar')
err_out=$(check_tables_present "${present}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a missing table is a failure"
assert_contains "$err_out" "event" "message names the missing table"

echo "test: check_tables_present fails when SequelizeMeta is absent"
present=$(printf '%s\n' 'account' 'calendar' 'event')
err_out=$(check_tables_present "${present}" 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a dump without SequelizeMeta is a failure"
assert_contains "$err_out" "SequelizeMeta" "message names SequelizeMeta"

echo "test: backup_mount_spec defaults to the named compose volume, read-only"
out=$(BACKUP_DIR="" BACKUP_VOLUME="pavillion-backups" backup_mount_spec)
assert_eq "pavillion-backups:/backup:ro" "$out" "named volume mounted read-only"

echo "test: backup_mount_spec honours an explicit host directory"
host_dir="${WORK}/backups"
mkdir -p "${host_dir}"
out=$(BACKUP_DIR="${host_dir}" backup_mount_spec)
assert_eq "${host_dir}:/backup:ro" "$out" "host directory mounted read-only"

echo "test: backup_mount_spec fails when the host directory does not exist"
err_out=$(BACKUP_DIR="${host_dir}/nope" backup_mount_spec 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "a missing backup directory is a failure"
assert_contains "$err_out" "not found" "message names the unreadable directory"

echo "test: cleanup_drill is idempotent"
CONTAINER_NAME=""
cleanup_drill >/dev/null 2>&1
first=$?
cleanup_drill >/dev/null 2>&1
second=$?
assert_exit_code "0" "$first" "first cleanup succeeds with nothing to remove"
assert_exit_code "0" "$second" "second cleanup is a no-op, not an error"

report_results
