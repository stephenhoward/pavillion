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

# --- Source-level safety assertions ------------------------------------------
#
# Every extraction below is anchored to the real invocation. The obvious form —
# grep -A n 'docker run' — matches the header comment first, and that comment
# quotes --network none and --rm while explaining them, so the assertions would
# pass against an invocation that had lost both flags. An assertion that cannot
# fail on a mutant is not an assertion.

echo "test: the safety-critical flags are on the real docker run invocation"
run_block=$(sed -n '/^  if ! docker run/,/DRILL_IMAGE/p' "${DRILL}")
run_first=$(printf '%s\n' "${run_block}" | head -n 1)
run_last=$(printf '%s\n' "${run_block}" | tail -n 1)
assert_contains "$run_first" 'if ! docker run' "the extracted block starts at the docker run invocation"
assert_contains "$run_last" '${DRILL_IMAGE}' "the extracted block ends at the image argument"
assert_contains "$run_block" '--network none' "docker run uses --network none"
assert_contains "$run_block" '--rm' "docker run creates a self-removing container"
assert_contains "$run_block" '--volume "${mount_spec}"' "docker run mounts the validated backup spec"

echo "test: the scratch container is capped while it parses an untrusted archive"
assert_contains "$run_block" '--security-opt no-new-privileges' "no-new-privileges is set"
assert_contains "$run_block" '--pids-limit' "the container has a pid cap"
assert_contains "$run_block" '--memory' "the container has a memory cap"

echo "test: the pg_restore invocation never carries the destructive -c/--clean flag"
restore_block=$(sed -n '/drill_exec pg_restore/,/); then$/p' "${DRILL}")
assert_contains "$restore_block" 'drill_exec pg_restore' "the pg_restore invocation was located"
assert_contains "$restore_block" '"/backup/${backup}"' "the extracted block ends at the archive argument"
# Matches a bare -c and a line-continued `--clean \` on its own continuation
# line, which is the shape a real regression would take here.
if printf '%s\n' "${restore_block}" | grep -qE '(^|[[:space:]])(-c|--clean)([[:space:]]|\\|$)'; then
  fail "the pg_restore invocation carries -c/--clean"
else
  echo "  PASS: no -c and no line-continued --clean in the pg_restore invocation"
  _TESTS=$((_TESTS+1))
fi
assert_contains "$restore_block" '--exit-on-error' "any restore error is fatal"

echo "test: pg_restore output is captured, not inherited"
# PostgreSQL quotes the offending row in CONTEXT:/DETAIL: lines on exactly the
# corrupt-dump failures this drill exists to catch, so the child's output must
# not stream to the cron log unfiltered.
assert_contains "$restore_block" 'restore_output=$(drill_exec pg_restore' "the child's output is captured into a variable"
assert_contains "$restore_block" '2>&1)' "stderr is folded into the captured output rather than inherited"
filter_block=$(sed -n '/pg_restore reported:/,/return 1/p' "${DRILL}")
assert_contains "$filter_block" 'redact_restore_output "${restore_output}"' "the captured output is redacted before it is printed"

echo "test: the scratch password is never expanded into a command line"
# Inverted from a shape-matching deny-list to an invariant: the value is only
# ever referenced by name. The generation line uses a command substitution, so
# no legitimate line in the script expands POSTGRES_PASSWORD at all.
run_cred_lines=$(printf '%s\n' "${run_block}" | grep 'POSTGRES_PASSWORD' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
assert_eq '--env POSTGRES_PASSWORD \' "$run_cred_lines" "the only password line in the docker run is the name-only form"
expanded=$(grep -nE '\$\{?POSTGRES_PASSWORD' "${DRILL}" | grep -v '^[0-9]*:[[:space:]]*#')
assert_eq "" "$expanded" "no line expands the password value"
pgpassword=$(grep -n 'PGPASSWORD=' "${DRILL}" | grep -v '^[0-9]*:[[:space:]]*#')
assert_eq "" "$pgpassword" "no PGPASSWORD= assignment (the handleBackupRestore anti-pattern)"
uri_credential=$(grep -nF ':${POSTGRES_PASSWORD}' "${DRILL}")
assert_eq "" "$uri_credential" "no credential embedded in a connection URI"
assert_contains "$(cat "${DRILL}")" 'unset POSTGRES_PASSWORD' "the password is dropped once the container holds it"

echo "test: drill_exec passes argv, never a shell string"
# This is what keeps a dump filename out of a shell. handleBackupRestore builds
# a shell string instead; the drill must not drift toward that shape.
drill_exec_body=$(sed -n '/^drill_exec() {/,/^}/p' "${DRILL}")
assert_contains "$drill_exec_body" 'docker exec "${CONTAINER_NAME}" "$@"' "arguments reach docker exec as argv"
if grep -qE 'sh -c "' "${DRILL}"; then
  fail "a double-quoted shell string is interpolated into a container command"
else
  echo "  PASS: no interpolating sh -c string anywhere in the drill"
  _TESTS=$((_TESTS+1))
fi

echo "test: the teardown traps exist and are installed before the container"
assert_eq "1" "$(grep -c 'trap cleanup_drill EXIT' "${DRILL}")" "an EXIT trap tears the container down"
assert_eq "1" "$(grep -c 'trap on_signal INT TERM' "${DRILL}")" "an INT/TERM trap tears the container down"
trap_line=$(grep -n 'trap on_signal INT TERM' "${DRILL}" | cut -d: -f1)
name_line=$(grep -n 'CONTAINER_NAME="pavillion-restore-drill' "${DRILL}" | cut -d: -f1)
run_line=$(grep -n '^  if ! docker run' "${DRILL}" | cut -d: -f1)
if (( trap_line > 0 && trap_line < name_line && name_line < run_line )); then
  echo "  PASS: traps installed (${trap_line}), then CONTAINER_NAME set (${name_line}), then docker run (${run_line})"
  _TESTS=$((_TESTS+1))
else
  fail "trap / CONTAINER_NAME / docker run are out of order (${trap_line:-none}/${name_line:-none}/${run_line:-none})"
fi

echo "test: cleanup verifies the removal instead of discarding its outcome"
cleanup_body=$(sed -n '/^cleanup_drill() {/,/^}/p' "${DRILL}")
assert_contains "$cleanup_body" 'docker rm --force --volumes' "cleanup removes the anonymous PGDATA volume too"
assert_contains "$cleanup_body" 'drill_container_ids' "cleanup checks whether the container survived"
ids_body=$(sed -n '/^drill_container_ids() {/,/^}/p' "${DRILL}")
assert_contains "$ids_body" 'docker ps -aq --filter "name=^${CONTAINER_NAME}$"' "the survivor check is name-anchored"

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

echo "test: resolve_requested_backup reads a leading-dash argument as a filename, not a grep option"
# Asserted on the exact output: without the -- guard the name reaches grep as an
# option and grep's own usage text joins the drill's error on stderr.
err_out=$(resolve_requested_backup "${listing}" "-x" 2>&1)
assert_eq "Error: backup file not found in the backup source: -x" "$err_out" \
  "a leading-dash name produces the drill's error and nothing else"

echo "test: main rejects a leading-dash argument before touching Docker"
err_out=$(main --bogus 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
assert_exit_code "1" "$err_code" "an unknown option is a failure"
assert_contains "$err_out" "unknown option" "message names the rejected option"

echo "test: main --help renders the header block and exits 0"
help_out=$(main --help 2>&1; echo "EXIT:$?")
assert_exit_code "0" "${help_out##*EXIT:}" "--help is a success"
assert_contains "$help_out" "Usage:" "--help renders the usage section"

echo "test: usage() documents every environment variable the script reads"
usage_out=$(usage)
assert_contains "$usage_out" "Usage:" "usage output has a Usage section"
assert_contains "$usage_out" "PAVILLION_BACKUP_VOLUME" "PAVILLION_BACKUP_VOLUME is documented"
assert_contains "$usage_out" "PAVILLION_BACKUP_DIR" "PAVILLION_BACKUP_DIR is documented"
assert_contains "$usage_out" "PAVILLION_DRILL_IMAGE" "PAVILLION_DRILL_IMAGE is documented"
assert_contains "$usage_out" "PAVILLION_DRILL_TIMEOUT" "PAVILLION_DRILL_TIMEOUT is documented"
assert_contains "$usage_out" "PAVILLION_MIGRATIONS_DIR" "PAVILLION_MIGRATIONS_DIR is documented"
assert_contains "$usage_out" "130" "exit code 130 (interrupted) is documented"

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

echo "test: evaluate_core_table_counts fails on a count that is not a positive integer"
# Fail-closed: an unreadable or truncated count must not score as populated,
# because a silent pass is this script's worst outcome.
counts=$(printf '%s\n' 'account|' 'calendar|2' 'event|17')
err_out=$(evaluate_core_table_counts "${counts}" 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "an empty count is a failure"
assert_contains "$err_out" "account" "message names the unreadable table"

counts=$(printf '%s\n' 'account|ERROR' 'calendar|2' 'event|17')
err_out=$(evaluate_core_table_counts "${counts}" 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "a non-numeric count is a failure"

counts=$(printf '%s\n' 'account|1' 'calendar|2' 'event|17')
evaluate_core_table_counts "${counts}" >/dev/null 2>&1
assert_exit_code "0" "$?" "a count of 1 still passes"

echo "test: redact_restore_output keeps the failing operation and drops the row content"
# The realistic shape of a pg_restore failure on a corrupt or partial dump —
# the DETAIL/CONTEXT lines Postgres appends quote production data verbatim, and
# this drill is designed to run monthly from cron into a log.
restore_stderr=$(printf '%s\n' \
  'pg_restore: connecting to database for restore' \
  'pg_restore: error: COPY failed for table "account": ERROR:  duplicate key value violates unique constraint "account_email_key"' \
  'DETAIL:  Key (email)=(person@example.com) already exists.' \
  'CONTEXT:  COPY account, line 42: "person@example.com	hunter2"' \
  'pg_restore: error: could not read from input file: end of file')
redacted=$(redact_restore_output "${restore_stderr}")
assert_contains "$redacted" 'COPY failed for table' "the failing operation is still named"
assert_contains "$redacted" 'could not read from input file' "every error line is reported, not just the first"
if printf '%s\n' "${redacted}" | grep -qE '(person@example\.com|hunter2)'; then
  fail "redacted output still carries row content from the dump"
else
  echo "  PASS: no row value survives redaction"
  _TESTS=$((_TESTS+1))
fi
assert_eq "" "$(printf '%s\n' "${redacted}" | grep -E '(DETAIL|CONTEXT):')" "no DETAIL/CONTEXT line survives"
assert_eq "" "$(printf '%s\n' "${redacted}" | grep -F 'connecting to database')" "non-error chatter is dropped"

echo "test: redact_restore_output strips DETAIL text appended to an error line itself"
restore_stderr='pg_restore: error: COPY failed: ERROR: invalid input DETAIL:  Key (email)=(person@example.com) already exists.'
redacted=$(redact_restore_output "${restore_stderr}")
assert_contains "$redacted" 'COPY failed' "the operation survives"
if printf '%s\n' "${redacted}" | grep -q 'person@example.com'; then
  fail "an inline DETAIL: clause leaked a row value"
else
  echo "  PASS: an inline DETAIL: clause is truncated"
  _TESTS=$((_TESTS+1))
fi

echo "test: redact_restore_output caps a flood of error lines"
restore_stderr=$(for i in $(seq 1 60); do echo "pg_restore: error: line ${i}"; done)
redacted=$(redact_restore_output "${restore_stderr}")
assert_eq "20" "$(printf '%s\n' "${redacted}" | grep -c 'pg_restore: error:')" "at most 20 error lines are echoed"

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

echo "test: backup_mount_spec rejects a relative host directory"
err_out=$(BACKUP_DIR="relative/backups" backup_mount_spec 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "a relative path is a failure, not an opaque Docker mount error"
assert_contains "$err_out" "absolute path" "message says the path must be absolute"

echo "test: backup_mount_spec rejects a volume name that is really a path"
err_out=$(BACKUP_DIR="" BACKUP_VOLUME="/opt/pavillion/backups" backup_mount_spec 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "an absolute path as a volume name is a failure"
assert_contains "$err_out" "volume name" "message says a volume name was expected"

echo "test: backup_mount_spec rejects a volume name carrying mount options"
err_out=$(BACKUP_DIR="" BACKUP_VOLUME="pavillion-backups:/backup:rw" backup_mount_spec 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "a colon in the volume name is a failure"

echo "test: backup_mount_spec rejects an empty backup source"
err_out=$(BACKUP_DIR="" BACKUP_VOLUME="" backup_mount_spec 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${err_out##*EXIT:}" "no volume and no directory is a failure"

echo "test: cleanup_drill is idempotent"
CONTAINER_NAME=""
_CLEANED_UP=0
cleanup_drill >/dev/null 2>&1
first=$?
cleanup_drill >/dev/null 2>&1
second=$?
assert_exit_code "0" "$first" "first cleanup succeeds with nothing to remove"
assert_exit_code "0" "$second" "second cleanup is a no-op, not an error"

# The two tests below shadow `docker` with a shell function so the cleanup path
# can be exercised without a daemon. Both restore the real command afterwards.
echo "test: cleanup_drill says nothing when the container is really gone"
docker() { return 0; }
CONTAINER_NAME="pavillion-restore-drill-fake"
_CLEANED_UP=0
out=$(cleanup_drill 2>&1)
assert_eq "" "$out" "a successful removal is silent"
unset -f docker

echo "test: cleanup_drill warns, and names the container, when removal fails"
# The old form discarded every failure mode, so a surviving container — a live
# postgres holding a full copy of the production database — was invisible and
# the drill still printed RESTORE DRILL PASSED.
docker() {
  case "$1" in
    rm) return 1 ;;
    ps) echo "deadbeefcafe" ;;
  esac
  return 0
}
sleep() { :; }
CONTAINER_NAME="pavillion-restore-drill-fake"
_CLEANED_UP=0
warn_out=$(cleanup_drill 2>&1; echo "EXIT:$?")
assert_exit_code "0" "${warn_out##*EXIT:}" "cleanup still succeeds — it must never be what fails a drill"
assert_contains "$warn_out" "WARNING" "a surviving container is reported"
assert_contains "$warn_out" "pavillion-restore-drill-fake" "the warning names the surviving container"
assert_contains "$warn_out" "docker rm -fv" "the warning names the manual removal command"
unset -f docker
unset -f sleep
CONTAINER_NAME=""

report_results
