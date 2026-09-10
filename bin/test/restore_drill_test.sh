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

# Records a failure when forbidden text IS present. The suite's source-level
# assertions were otherwise all of the "this flag is still here" kind, which
# guards against a flag being deleted and says nothing about a dangerous one
# being added — and adding is the cheaper mistake to make.
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
# Matched by reference rather than by literal braces, so rewriting the argument
# as "$DRILL_IMAGE" is a cosmetic change and not a test failure.
if printf '%s\n' "${run_last}" | grep -qE '\$\{?DRILL_IMAGE\}?'; then
  echo "  PASS: the extracted block ends at the image argument"
  _TESTS=$((_TESTS+1))
else
  fail "the extracted block does not end at the image argument (got: ${run_last})"
fi

# Docker reads --flag=value and --flag value identically, and every extraction
# here originally saw only the second spelling: --cap-add=SYS_ADMIN,
# --network=host, --user=root and --volume=/:/host all survived the suite, as did
# a --cap-add tucked mid-line where a line-anchored sed never looks. Normalising
# `=` to a space once, and tokenising the result on whitespace, collapses both
# spellings into the one the assertions below already understand. Deny-list
# needles are therefore written in the space form even where Docker only accepts
# the `=` one.
run_norm=$(printf '%s\n' "${run_block}" | tr '=' ' ')
run_tokens=$(printf '%s\n' "${run_norm}" | tr '[:space:]' '\n' | sed '/^[[:space:]]*$/d')

assert_contains "$run_norm" '--network none' "docker run uses --network none"
assert_contains "$run_norm" '--rm' "docker run creates a self-removing container"
assert_contains "$run_norm" '--volume "${mount_spec}"' "docker run mounts the validated backup spec"

echo "test: docker run carries exactly the reviewed set of flags"
# Set equality, not a deny-list. A deny-list only ever forbids what someone
# thought of; this fails on any flag that was not reviewed, whichever spelling it
# arrives in — and it fails on a deletion too, so it does not need pairing with a
# presence assertion for each name.
run_flags=$(printf '%s\n' "${run_tokens}" \
  | grep -E '^--[a-z][a-z-]*$' \
  | LC_ALL=C sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//')
assert_eq "--cap-add --cap-drop --detach --env --memory --name --network --pids-limit --rm --security-opt --volume" \
  "$run_flags" "no flag has been added to or removed from the docker run"

echo "test: the scratch container is capped while it parses an untrusted archive"
# no-new-privileges is asserted by VALUE. Docker parses it with strconv.ParseBool,
# so `:false` is one spelling out of many — `:0`, `=0`, `:f`, `:FALSE` and
# `=False` all disable it and a deny-list caught none of them. This is the same
# value-blindness already fixed for --pids-limit and --memory below, so it gets
# the same treatment: state what the value must be, rather than one thing it
# must not be.
nnp_value=$(printf '%s\n' "${run_block}" | sed -nE 's/.*--security-opt[[:space:]=]+([^[:space:]\\]+).*/\1/p')
if [[ "${nnp_value}" =~ ^no-new-privileges([=:]true)?$ ]]; then
  echo "  PASS: no-new-privileges is set to a value Docker reads as true (${nnp_value})"
  _TESTS=$((_TESTS+1))
else
  fail "--security-opt does not positively enable no-new-privileges (got: ${nnp_value:-none})"
fi
assert_contains "$run_norm" '--pids-limit' "the container has a pid cap"
assert_contains "$run_norm" '--memory' "the container has a memory cap"

echo "test: the container keeps only the capabilities the postgres entrypoint needs"
# The entrypoint gosu's from root to postgres (SETGID/SETUID) and fixes up PGDATA
# permissions (DAC_OVERRIDE). Everything else — CAP_MKNOD, CAP_SYS_CHROOT,
# CAP_NET_RAW, CAP_SETFCAP, CAP_SETPCAP among them — is dropped, because
# execution inside this container is the assumed starting point of the threat
# model, not the end of it. An allow-list: a fourth --cap-add is a failure.
assert_contains "$run_norm" '--cap-drop ALL' "every capability is dropped first"
# Read off the token stream rather than with a line-anchored sed: --cap-add=SYS_ADMIN
# and a second --cap-add sharing a line with the first were both invisible to the
# anchored form, so the allow-list passed while a capability was added.
cap_adds=$(printf '%s\n' "${run_tokens}" \
  | awk '/^--cap-add$/ { getline value; print value }' \
  | LC_ALL=C sort | tr '\n' ' ' | sed 's/[[:space:]]*$//')
assert_eq "DAC_OVERRIDE SETGID SETUID" "$cap_adds" \
  "exactly the three needed capabilities are re-added, and no others"

echo "test: no dangerous flag has been added to the docker run"
# The assertions above all guard against deletion. These guard against addition:
# every one of them passed against the invocation before they were written.
# Read against the normalised block, so `--network=host` and `--network host` are
# the same string here — which is why the needles are written in the space form
# even for `seccomp=unconfined`, which Docker only spells with an `=`.
assert_absent "$run_norm" '--privileged' "the container is not privileged"
assert_absent "$run_norm" '--network host' "the container does not join the host network"
assert_absent "$run_norm" '--pid host' "the container does not share the host pid namespace"
assert_absent "$run_norm" '--ipc host' "the container does not share the host ipc namespace"
assert_absent "$run_norm" '--user root' "the container does not force the root user"
assert_absent "$run_norm" '--user 0' "the container does not force uid 0"
assert_absent "$run_norm" 'seccomp unconfined' "the seccomp profile is not disabled"
assert_absent "$run_norm" 'apparmor unconfined' "the apparmor profile is not disabled"
assert_absent "$run_norm" '--device' "no host device is passed through"
assert_absent "$run_norm" '--cap-add ALL' "capabilities are not re-added wholesale"

echo "test: the backup mount is the only mount, and it is read-only"
# A second --volume is how a drill container would acquire a writable view of
# the host while every existing assertion still passed.
mount_count=$(printf '%s\n' "${run_norm}" | grep -cE '(^|[[:space:]])(--volume|--mount|-v)[[:space:]]')
assert_eq "1" "$mount_count" "exactly one mount is passed to docker run"
assert_contains "$(grep -n 'echo "${BACKUP_VOLUME}:/backup:ro"' "${DRILL}")" ':ro' "the volume spec is built read-only"

echo "test: the pid and memory caps carry real values, not just the flag names"
# Presence-only assertions passed against --pids-limit 999999999 and --memory 0
# (which means "unlimited"), so the values themselves are asserted.
pids_value=$(printf '%s\n' "${run_norm}" | sed -nE 's/^[[:space:]]*--pids-limit[[:space:]]+([^[:space:]\\]+).*/\1/p')
if [[ "${pids_value}" =~ ^[0-9]+$ ]] && (( pids_value > 0 && pids_value <= 4096 )); then
  echo "  PASS: --pids-limit is a real bound (${pids_value})"
  _TESTS=$((_TESTS+1))
else
  fail "--pids-limit is not a real bound (got: ${pids_value:-none}); 0 and -1 mean unlimited"
fi
mem_value=$(printf '%s\n' "${run_norm}" | sed -nE 's/^[[:space:]]*--memory[[:space:]]+([^[:space:]\\]+).*/\1/p')
if [[ "${mem_value}" =~ ^([0-9]+)([mMgG])$ ]]; then
  mem_mb="${BASH_REMATCH[1]}"
  [[ "${BASH_REMATCH[2]}" == [gG] ]] && mem_mb=$(( mem_mb * 1024 ))
  if (( mem_mb >= 256 && mem_mb <= 4096 )); then
    echo "  PASS: --memory is a real bound (${mem_value})"
    _TESTS=$((_TESTS+1))
  else
    fail "--memory ${mem_value} is outside the sane 256m-4g range for a scratch database"
  fi
else
  fail "--memory is not a bounded size (got: ${mem_value:-none}); 0 means unlimited"
fi

echo "test: the pg_restore invocation never carries the destructive -c/--clean flag"
# The end anchor tolerates whitespace around the `;`. Pinned to `); then$` it
# would find no end line if the closing line were reformatted as `) ; then`,
# and sed would then run the range to EOF — extracting the whole rest of the
# file, which is the one input that makes the deny-grep below vacuous.
restore_block=$(sed -n '/drill_exec pg_restore/,/)[[:space:]]*;[[:space:]]*then/p' "${DRILL}")
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

echo "test: no interpolating sh -c string reaches a container command"
if grep -qE 'sh -c "' "${DRILL}"; then
  fail "a double-quoted shell string is interpolated into a container command"
else
  echo "  PASS: no interpolating sh -c string anywhere in the drill"
  _TESTS=$((_TESTS+1))
fi

echo "test: the teardown traps exist and are installed before the container"
assert_eq "1" "$(grep -c 'trap on_exit EXIT' "${DRILL}")" "an EXIT trap tears the container down"
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
# Counted, not merely present. cleanup_drill has two rm call sites — the first
# attempt and the retry — and presence passed with --volumes dropped from the
# first. If that regressed and the first rm succeeded, the anonymous PGDATA
# volume (a full unencrypted copy of production) would be orphaned on the host
# while the drill printed PASSED and exited 0.
assert_eq "2" "$(printf '%s\n' "${cleanup_body}" | grep -c 'docker rm --force --volumes')" \
  "both removal call sites take the anonymous PGDATA volume with them"
assert_contains "$cleanup_body" 'drill_container_ids' "cleanup checks whether the container survived"
ids_body=$(sed -n '/^drill_container_ids() {/,/^}/p' "${DRILL}")
assert_contains "$ids_body" 'docker ps -aq --filter "name=^${CONTAINER_NAME}$"' "the survivor check is name-anchored"

# Sourcing must not run the drill. If the entry guard is wrong this hangs or
# fails here rather than silently launching Docker.
source "${DRILL}"

echo "test: drill_exec hands docker argv, never a shell string"
# Behavioural, not source-shape. The old form grepped for the exact text
# `docker exec "${CONTAINER_NAME}" "$@"`, which failed on a harmless reformat
# (`docker exec -- "${CONTAINER_NAME}" "$@"`) and caught a real regression only
# because the regression happened to change that same text. Here `docker` is
# shadowed and the argv it actually received is inspected: this is what keeps an
# attacker-influenced dump filename out of a shell.
docker() {
  local a
  for a in "$@"; do printf '[%s]\n' "$a"; done
}
CONTAINER_NAME="drill-argv-probe"
# The canary lives under the per-run work directory, not at a fixed /tmp path: on
# a shared host anyone can plant a symlink at a name they can predict, and the
# test would then either report a leak that did not happen or overwrite something
# that is not its own.
argv_canary="${WORK}/pv-drill-pwned"
rm -f "${argv_canary}"
argv_payload="SELECT * FROM \"a b\"; \$(touch ${argv_canary}) *"
argv_out=$(drill_exec psql -c "${argv_payload}")

# The container name must be the FIRST argv element after `exec`, allowing only
# the flags below in front of it. Presence alone was not the invariant: `docker
# exec --privileged "${CONTAINER_NAME}" "$@"` puts the name in the argv too, and
# it takes the exec'd process from CapEff 00000000000000c2 to 0000003fffffffff —
# silently undoing --cap-drop for pg_restore, the one process here that parses the
# untrusted archive. `--user root` and `--env PGPASSWORD=...` sit in the same
# position and were equally invisible. The allow-list is exactly the client-side
# locale pin, plus a bare `--` separator, so a reformat stays tolerated and
# anything else in front of the name is a failure.
argv_elems=()
while IFS= read -r argv_line; do
  argv_elems+=("${argv_line}")
done <<< "${argv_out}"
assert_eq '[exec]' "${argv_elems[0]:-none}" "docker is invoked as docker exec"
argv_i=1
while (( argv_i < ${#argv_elems[@]} )); do
  if [[ "${argv_elems[argv_i]}" == '[--env]' && "${argv_elems[argv_i+1]:-}" == '[LC_ALL=C]' ]]; then
    argv_i=$((argv_i + 2))
  elif [[ "${argv_elems[argv_i]}" == '[--]' ]]; then
    argv_i=$((argv_i + 1))
  else
    break
  fi
done
assert_eq '[drill-argv-probe]' "${argv_elems[argv_i]:-none}" \
  "the container name is the first argv element after exec and the allowed flags"
assert_contains "$argv_out" '[LC_ALL=C]' "every exec carries the client-side locale pin that keeps pg_restore's own prefix ASCII"
# Asserted on the tail rather than on a total count, so inserting a `--`
# separator stays a tolerated reformat while any re-splitting, globbing or
# re-joining of the three arguments is not.
assert_eq "$(printf '%s\n' '[psql]' '[-c]' "[${argv_payload}]")" \
  "$(printf '%s\n' "${argv_out}" | tail -n 3)" \
  "the three arguments arrive as three elements, spaces and metacharacters unexpanded"
unset -f docker
CONTAINER_NAME=""
if [[ -e "${argv_canary}" ]]; then
  rm -f "${argv_canary}"
  fail "drill_exec let a command substitution in an argument execute"
else
  echo "  PASS: the command substitution in the argument never executed"
  _TESTS=$((_TESTS+1))
fi

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
# `docker` is shadowed for this one because the test's own failure mode is
# expensive: if the -*) guard is ever dropped, --bogus falls through as a
# requested filename and main() reaches a real `docker run`, pulling an image
# and creating a container on a dev machine or in CI instead of failing an
# assertion. The stub makes that outcome a visible failed assertion.
docker() { echo "REAL-DOCKER-INVOKED $*"; return 1; }
err_out=$(main --bogus 2>&1; echo "EXIT:$?")
err_code="${err_out##*EXIT:}"
unset -f docker
assert_exit_code "1" "$err_code" "an unknown option is a failure"
assert_contains "$err_out" "unknown option" "message names the rejected option"
assert_absent "$err_out" "REAL-DOCKER-INVOKED" "the option was rejected before any docker command ran"

echo "test: validate_drill_settings rejects a timeout that is not a plain number"
# PAVILLION_DRILL_TIMEOUT reaches `(( waited < DRILL_TIMEOUT ))`. Bash evaluates
# arithmetic recursively and evaluates array subscripts inside it, so a value
# naming a bound variable with a command substitution as its subscript executes
# that command. set -u does not stop it. The drill is documented as a cron job,
# so the attacker here is whoever can write an EnvironmentFile without being
# able to touch the script — and they would land as a user with Docker socket
# access.
#
# The last two are the upper bound. Without one, 99999999999999999999 passed
# validation and then wrapped in 64-bit arithmetic, hanging the drill for as long
# as it liked while a container held a copy of production — so the cap is checked
# on the digit count before the comparison, which is what the 20-digit case here
# exercises and the 3601 case does not.
for bad_timeout in 'waited[$(echo PWNED)]' 'abc' '' '9 9' '-5' '1e3' '0x10' '0' '3601' '99999999999999999999'; do
  err_out=$(DRILL_TIMEOUT="${bad_timeout}" DRILL_IMAGE="postgres:17" validate_drill_settings 2>&1; echo "EXIT:$?")
  assert_exit_code "1" "${err_out##*EXIT:}" "timeout '${bad_timeout}' is rejected"
done

echo "test: the arithmetic context itself is guarded, not just main()"
# wait_for_scratch_db is where the value actually reaches arithmetic, so it
# revalidates rather than trusting a caller. Asserted by running the auditor's
# working payload straight at that function.
#
# The canary is a file, not a marker in the output: the rejection message
# echoes the offending value back to the operator, so the payload's own text
# appears in stderr either way. Only a side effect on disk distinguishes
# "executed" from "quoted in an error".
canary="${WORK}/pv-arith-canary"
rm -f "${canary}"
probe=$(DRILL_TIMEOUT="waited[\$(touch ${canary})]" DRILL_IMAGE="postgres:17" \
  wait_for_scratch_db 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${probe##*EXIT:}" "a non-numeric timeout fails wait_for_scratch_db cleanly"
if [[ -e "${canary}" ]]; then
  rm -f "${canary}"
  fail "the command substitution in the array subscript executed"
else
  echo "  PASS: the command substitution in the subscript never executed"
  _TESTS=$((_TESTS+1))
fi
assert_absent "$probe" "unbound variable" "the failure is a stated error, not an obscure bash abort"
assert_contains "$probe" "PAVILLION_DRILL_TIMEOUT" "the error names the variable the operator set"

echo "test: main validates the settings before it starts a container"
# The guard in wait_for_scratch_db alone would still stop the exploit, but only
# after docker run has already created a postgres container — which is the
# obscure late abort the review called out. main() must reject the setting
# first, so the operator gets a stated error and no container.
#
# main() is called in a subshell because it installs its own EXIT trap, which
# would otherwise replace this suite's cleanup trap and exit the test process.
docker() { case "$1" in run) echo "DOCKER-CALLED-RUN" ;; esac; return 1; }
probe=$( (DRILL_TIMEOUT="abc"; main) 2>&1; echo "EXIT:$?")
unset -f docker
assert_exit_code "1" "${probe##*EXIT:}" "a bad timeout fails the drill"
assert_contains "$probe" "PAVILLION_DRILL_TIMEOUT" "the error names the variable the operator set"
assert_absent "$probe" "DOCKER-CALLED-RUN" "no container was created before the setting was rejected"

echo "test: validate_drill_settings accepts a plain positive timeout"
DRILL_TIMEOUT="90" DRILL_IMAGE="postgres:17" validate_drill_settings >/dev/null 2>&1
assert_exit_code "0" "$?" "the documented default passes validation"

echo "test: validate_drill_settings rejects an image that would parse as an option"
# The image sits in the option-parsing region of `docker run`, so a leading dash
# is read as a flag. It is argv, so this is not injection — it is the same class
# of unvalidated input as the timeout, and the guard costs a line.
for bad_image in '-v/:/host' '--privileged' ''; do
  err_out=$(DRILL_TIMEOUT="90" DRILL_IMAGE="${bad_image}" validate_drill_settings 2>&1; echo "EXIT:$?")
  assert_exit_code "1" "${err_out##*EXIT:}" "image '${bad_image}' is rejected"
  assert_contains "$err_out" "PAVILLION_DRILL_IMAGE" "the error names the variable the operator set"
done
DRILL_TIMEOUT="90" DRILL_IMAGE="ghcr.io/example/postgres:17-alpine" validate_drill_settings >/dev/null 2>&1
assert_exit_code "0" "$?" "an ordinary registry reference passes validation"

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

echo "test: compare_migration_sets prints untrusted migration names literally"
# The `extra` set comes straight out of the dump's "SequelizeMeta" table, which
# is attacker-controlled when drilling a foreign dump. Printed unquoted, a
# stored name of `*` globs against the working directory and a name with spaces
# splits across lines — so the report would show the operator this host's
# filenames and a mangled list instead of what the dump actually holds.
# Re-unquoting the printf in compare_migration_sets passed the whole suite
# before this test existed.
hostile=$(printf '%s\n' '*' 'a b c.ts' '0001_a.ts')
err_out=$(compare_migration_sets "$(printf '%s\n' '0001_a.ts')" "${hostile}" 2>&1)
assert_eq "1" "$(printf '%s\n' "${err_out}" | grep -cxF '        *')" \
  "a stored name of * is printed literally, not glob-expanded"
assert_eq "1" "$(printf '%s\n' "${err_out}" | grep -cxF '        a b c.ts')" \
  "a stored name with spaces stays one line"
assert_absent "$err_out" "restore-drill.sh" "no working-directory filename leaked into the report"

echo "test: compare_migration_sets prints untrusted names literally in the missing set too"
err_out=$(compare_migration_sets "${hostile}" "$(printf '%s\n' '0001_a.ts')" 2>&1)
assert_eq "1" "$(printf '%s\n' "${err_out}" | grep -cxF '        *')" \
  "a missing name of * is printed literally"
assert_eq "1" "$(printf '%s\n' "${err_out}" | grep -cxF '        a b c.ts')" \
  "a missing name with spaces stays one line"

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

# --- Redaction --------------------------------------------------------------
#
# PROVENANCE OF THESE FIXTURES. Every one below was captured from a real
# postgres:17 container, not written from imagination. The previous fixtures
# were hand-authored, and hand-authoring is what encoded the wrong assumption
# they were then used to confirm: that only DETAIL:/CONTEXT: carries row data.
# Real pg_restore contradicts that twice over — it puts DETAIL:/CONTEXT: on
# their own physical lines (so a line-prefix filter drops them for free), and it
# quotes the offending value INLINE on the "pg_restore: error:" line itself,
# where no label follows it to strip.
#
# How each was provoked, all against postgres:17 with a source table
# `account (id text, email text, token text)` dumped with pg_dump -Fc:
#   integer / uuid            — restored --data-only into a database whose
#     matching column had a mismatched type. Verbatim captures.
#   duplicate key             — restored --data-only over a conflicting row.
#     Verbatim capture, DETAIL:/CONTEXT: line placement included.
#   truncated / not-an-archive— restored a head -c'd dump, and a text file.
#     Verbatim captures.
# Two are composites, and are marked as such because it matters which:
#   encoding — the message body (`ERROR:  invalid byte sequence for encoding
#     "UTF8": 0xff`) is a verbatim capture from the same postgres:17, spliced
#     onto the verbatim `pg_restore: error: COPY failed for table "account": `
#     prefix, because a SQL_ASCII dump round-tripped through pg_restore without
#     erroring and would not produce the line on its own.
#   varchar — capture put the too-long value on the CONTEXT: line and left the
#     ERROR: line valueless (`value too long for type character varying(8)`).
#     The fixture below is instead the inline variant the audit reported. Both
#     are covered: the CONTEXT: line is dropped by the line filter, and the
#     inline variant by the redaction this fixture exercises.
#   zh_CN — the fixture in the round-4 test below was captured live from a
#     zh_CN.utf8 postgres:17 image built for the purpose, not translated by
#     hand. It is what defeated the two rules this file no longer tests,
#     because they no longer exist.

echo "test: redact_restore_output drops the value pg_restore quotes inline"
# The shapes a corrupt, truncated or mismatched dump actually produces — the
# failure class this drill exists to provoke. All of them survived the previous
# prefix-allow-list implementation verbatim.
while IFS='|' read -r shape secret line; do
  [[ -z "${shape}" ]] && continue
  redacted=$(redact_restore_output "${line}")
  if printf '%s\n' "${redacted}" | grep -qF -- "${secret}"; then
    fail "${shape}: the quoted value '${secret}' survived redaction"
  else
    echo "  PASS: ${shape}: the inline value is redacted"
    _TESTS=$((_TESTS+1))
  fi
  assert_contains "$redacted" 'COPY failed for table' "${shape}: the failing operation is still named"
  assert_contains "$redacted" 'account' "${shape}: the table name is still named"
done <<'FIXTURES'
integer|multi@example.com|pg_restore: error: COPY failed for table "account": ERROR:  invalid input syntax for type integer: "multi@example.com"
uuid|secret-token-abc123|pg_restore: error: COPY failed for table "account": ERROR:  invalid input syntax for type uuid: "secret-token-abc123"
encoding|0xff|pg_restore: error: COPY failed for table "account": ERROR:  invalid byte sequence for encoding "UTF8": 0xff
varchar|multi@example.com|pg_restore: error: COPY failed for table "account": ERROR:  value too long for type character varying(8): "multi@example.com"
FIXTURES

echo "test: redact_restore_output keeps the failing operation and drops the row content"
# Captured verbatim from pg_restore restoring --data-only over a conflicting
# row: note that DETAIL: and CONTEXT: arrive on their own physical lines, which
# is why the line filter alone already removes them.
restore_stderr=$(printf '%s\n' \
  'pg_restore: connecting to database for restore' \
  'pg_restore: error: COPY failed for table "account": ERROR:  duplicate key value violates unique constraint "account_email_key"' \
  'DETAIL:  Key (email)=(user1@example.com) already exists.' \
  'CONTEXT:  COPY account, line 1' \
  'pg_restore: error: could not read from input file: end of file')
redacted=$(redact_restore_output "${restore_stderr}")
assert_contains "$redacted" 'COPY failed for table' "the failing operation is still named"
assert_contains "$redacted" 'could not read from input file' "every error line is reported, not just the first"
if printf '%s\n' "${redacted}" | grep -qE '(user1@example\.com|account_email_key)'; then
  fail "redacted output still carries row content from the dump"
else
  echo "  PASS: no row value survives redaction"
  _TESTS=$((_TESTS+1))
fi
assert_eq "" "$(printf '%s\n' "${redacted}" | grep -E '(DETAIL|CONTEXT):')" "no DETAIL/CONTEXT line survives"
assert_eq "" "$(printf '%s\n' "${redacted}" | grep -F 'connecting to database')" "non-error chatter is dropped"

echo "test: redact_restore_output keeps the archive-level diagnostics whole"
# Redaction that eats the whole line would be safe and useless. These are the
# allow-list, and they are the operator's entire diagnosis when the archive
# itself is the problem — the drill's acceptance criteria require a failure to
# name which step failed. Asserted on the EXACT output, so a rule that kept them
# by accident (a stray wildcard in the allow-list, or a body-parsing heuristic
# that happened to stop in the right place) is not the same as one that kept
# them on purpose.
while IFS='|' read -r shape line; do
  [[ -z "${shape}" ]] && continue
  assert_eq "        ${line}" "$(redact_restore_output "${line}")" \
    "${shape}: the archive-level diagnostic survives byte-for-byte"
done <<'FIXTURES'
truncated|pg_restore: error: could not read from input file: end of file
bad header|pg_restore: error: did not find magic string in file header
not an archive|pg_restore: error: input file does not appear to be a valid archive (too short?)
FIXTURES

echo "test: redact_restore_output redacts an unrecognised shape rather than passing it through"
# The fail-closed default, and the reason the allow-list above is an allow-list.
# A pg_restore message this script has never seen — a future release's wording, a
# patched build's, a shape no capture covered — must lose its body, not keep it
# on the strength of not matching anything.
assert_eq '        pg_restore: error: some unrecognised operation: [redacted]' \
  "$(redact_restore_output 'pg_restore: error: some unrecognised operation: fatality at "person@example.com"')" \
  "an unknown message with a colon keeps only the operation"
assert_eq '        pg_restore: error: [redacted]' \
  "$(redact_restore_output 'pg_restore: error: an unknown colonless message naming person@example.com')" \
  "an unknown message with no colon is redacted whole"

echo "test: redact_restore_output drops a value that is split across physical lines"
# Round-3 defeat, captured live from postgres:17. The value wraps, so its closing
# quote lands on a physical line the "^pg_restore: error:" filter drops, and the
# quote-pairing rule that used to run here was left an opening quote with no
# partner — it matched nothing and a fragment of a production row reached output
# the header calls safe to paste into an issue. The coarse rule never looks for
# the quote at all, so where the value ends stopped mattering.
multiline_leak=$(printf '%s\n' \
  'pg_restore: error: COPY failed for table "account": erreur: syntaxe invalide pour le type integer : "multi@' \
  'example.com"')
assert_eq '        pg_restore: error: COPY failed for table "account": [redacted]' \
  "$(redact_restore_output "${multiline_leak}")" \
  "the operation and table are named and the orphaned fragment is gone"

echo "test: redact_restore_output drops a value holding a quote, behind a label with no case"
# Round-4 defeat, captured live against a zh_CN.utf8 postgres image. Two rules
# died on this one line. The ALL-CAPS truncation no-oped, because 错误: has no
# case distinction to key on — and LC_ALL=C cannot fix that, since the label is
# the SERVER's, fixed when the postmaster started from the image's baked-in LANG.
# The quote pairing then stopped at the " embedded in the value, because
# PostgreSQL does not escape it, and published the rest.
zh_leak='pg_restore: error: COPY failed for table "account2": 错误:  无效的类型 integer 输入语法: "quote"embed@example.com"'
redacted=$(redact_restore_output "${zh_leak}")
assert_eq '        pg_restore: error: COPY failed for table "account2": [redacted]' "$redacted" \
  "the operation and table are named and nothing of the message body survives"
assert_absent "$redacted" 'embed@example.com' "the value behind the embedded quote does not reach the log"

echo "test: redact_restore_output bounds the length of a single line"
# A pathological single line cannot dump the archive into a cron log. The long
# part is the archive member's own name, which is the part the rule KEEPS — so
# this exercises the byte bound rather than being shortened by redaction first.
long_line="pg_restore: error: COPY failed for table \"$(printf 'x%.0s' $(seq 1 4000))\": ERROR:  nope"
assert_eq "1" "$(redact_restore_output "${long_line}" | wc -l | tr -d ' ')" "the long line stays one line"
line_len=$(redact_restore_output "${long_line}" | sed 's/^        //' | awk '{ print length }')
assert_eq "200" "${line_len}" "a single line is truncated to the 200-byte bound"

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
#
# The stub COUNTS its rm invocations rather than only failing them. With a stub
# that merely returns 1, deleting the retry block entirely still passed this
# test: nothing observed how many times rm was called. The counter is a file
# because cleanup_drill is called inside a command substitution, so a shell
# variable incremented by the stub would die with the subshell.
RM_LOG="${WORK}/docker-rm-calls"
: > "${RM_LOG}"
docker() {
  case "$1" in
    rm) echo "rm" >> "${RM_LOG}"; return 1 ;;
    ps) echo "deadbeefcafe" ;;
  esac
  return 0
}
sleep() { :; }
CONTAINER_NAME="pavillion-restore-drill-fake"
_CLEANED_UP=0
_TEARDOWN_LEAKED=0
warn_out=$(cleanup_drill 2>&1; echo "EXIT:$?")
assert_exit_code "0" "${warn_out##*EXIT:}" "cleanup still succeeds — it must never be what fails a drill"
assert_contains "$warn_out" "WARNING" "a surviving container is reported"
assert_contains "$warn_out" "pavillion-restore-drill-fake" "the warning names the surviving container"
assert_contains "$warn_out" "docker rm -fv" "the warning names the manual removal command"
assert_eq "2" "$(wc -l < "${RM_LOG}" | tr -d ' ')" \
  "removal is retried once — a container that appears late is still removed"

echo "test: a drill that passes but leaks its container does not exit 0"
# An exit-code-driven monitor must not read a plain success while a postgres
# container still holds a full unencrypted copy of production. The drill verdict
# stays PASSED (teardown failure is not a backup failure) and the status becomes
# 3, which the header documents.
#
# on_exit calls exit, so it runs in a nested subshell — otherwise it would take
# the capturing command substitution with it and the EXIT: marker would never
# be appended.
_CLEANED_UP=0
_TEARDOWN_LEAKED=0
leak_out=$( ( (exit 0); on_exit ) 2>&1; echo "EXIT:$?")
assert_exit_code "3" "${leak_out##*EXIT:}" "a leaked container turns a passing drill into exit 3"
assert_contains "$leak_out" "PASSED" "the drill verdict is still reported as a pass"
assert_contains "$leak_out" "Exiting 3" "the message says which code is being used and why"
assert_contains "$(cat "${DRILL}")" "#   3  every check passed, but the scratch container could not be removed" \
  "exit code 3 is documented in the header's exit-code list"

echo "test: a clean teardown leaves the drill's own exit status alone"
unset -f docker
docker() { return 0; }
_CLEANED_UP=0
_TEARDOWN_LEAKED=0
clean_out=$( ( (exit 0); on_exit ) >/dev/null 2>&1; echo "EXIT:$?")
assert_exit_code "0" "${clean_out##*EXIT:}" "a passing drill with a clean teardown still exits 0"
_CLEANED_UP=0
_TEARDOWN_LEAKED=0
fail_out=$( ( (exit 1); on_exit ) >/dev/null 2>&1; echo "EXIT:$?")
assert_exit_code "1" "${fail_out##*EXIT:}" "a failing drill still exits 1"
unset -f docker
unset -f sleep
CONTAINER_NAME=""

report_results
