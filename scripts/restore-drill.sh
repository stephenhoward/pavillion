#!/usr/bin/env bash
#
# Pavillion Backup Restore Drill
#
# Proves that a backup can actually be restored. The drill restores the most
# recent database dump into a throwaway Postgres container, checks that the
# restored database looks like a real Pavillion instance, prints row counts,
# and destroys the container. It never touches the live database, and it never
# writes to the backup directory.
#
# Usage:
#   ./scripts/restore-drill.sh [backup-filename]
#   ./scripts/restore-drill.sh --help
#
# Arguments:
#   backup-filename   Optional. A bare filename inside the backup volume
#                     (for example pavillion_20260315_020000_scheduled.dump).
#                     Defaults to the newest .dump file present.
#
# Environment:
#   PAVILLION_BACKUP_VOLUME   Docker volume holding the backups.
#                             Default: pavillion-backups
#   PAVILLION_BACKUP_DIR      Host directory holding the backups. When set it
#                             replaces the volume. Useful for drilling a dump
#                             that lives outside the compose deployment.
#   PAVILLION_DRILL_IMAGE     Postgres image for the scratch database. Must
#                             match the deployed db service. Default: postgres:17
#   PAVILLION_DRILL_TIMEOUT   Seconds to wait for the scratch database to accept
#                             connections. Default: 90. Capped at 3600: the
#                             container is holding a full unencrypted copy of
#                             production for the whole wait, so an unbounded
#                             timeout is a longer exposure rather than a
#                             kindness. A larger value is rejected, not clamped.
#   PAVILLION_MIGRATIONS_DIR  Directory holding the migration files the dump is
#                             compared against. Default: <repo>/migrations
#
# Examples:
#   ./scripts/restore-drill.sh
#   ./scripts/restore-drill.sh pavillion_20260315_020000_scheduled.dump
#   PAVILLION_BACKUP_DIR=/tmp/dumps ./scripts/restore-drill.sh
#
# Exit codes:
#   0  every check passed and the scratch container was torn down
#   1  a check failed, or a prerequisite was missing; the reason is on stderr
#   3  every check passed, but the scratch container could not be removed. The
#      backup is fine; the host is not. A container holding a full unencrypted
#      copy of the production database is still running and needs removing by
#      hand — the WARNING on stderr names it. Split out from 0 so a monitor
#      watching exit codes cannot read this as an unqualified pass.
#   130  interrupted (SIGINT/SIGTERM); teardown is attempted first, and a leak
#        is reported on stderr. There is no 3-style split here: an interrupted
#        run exits 130 whether or not the container survived, so a monitor
#        watching exit codes must read the stderr to learn which it was.
#
# Safety properties, all of them mechanically visible in the docker run below:
#   - The scratch container runs with --network none, so it cannot reach the
#     compose project network or the live db service even by accident.
#   - The backup source is mounted at /backup with an explicit :ro suffix, so
#     the drill cannot modify or delete a backup.
#   - pg_restore executes the archive's SQL as the scratch superuser, and the
#     archive may come from outside this deployment, so the container is
#     additionally capped with --cap-drop ALL (re-adding only the three
#     capabilities the postgres entrypoint needs), --security-opt
#     no-new-privileges, --pids-limit and --memory. A hostile archive gets no
#     network, a read-only view of the backups, and a bounded, disposable
#     container stripped of every capability it does not need.
#   - The container is created with --rm and torn down, together with its
#     anonymous PGDATA volume, by an EXIT/INT/TERM trap installed before it is
#     created, so an interrupted run leaves nothing behind.
#   - pg_restore is never given -c. The target is a virgin scratch database,
#     so there is nothing to drop.
#   - The scratch superuser password is generated per run, passed to Docker by
#     variable name so it never appears on a command line or in the shell
#     history, and never echoed. Verification connects over the container's
#     unix socket, which needs no password at all.
#
# Not covered: media. Pavillion's backup system runs pg_dump only and produces
# no media archive, so a passing drill says nothing about whether media is
# backed up. Media backup is an operator-owned volume snapshot documented
# separately.
#

# Strict mode applies only when this file is executed. bin/test/restore_drill_test.sh
# sources it to call the pure functions directly, and must not inherit -e.
__DRILL_EXECUTED=0
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  __DRILL_EXECUTED=1
  set -euo pipefail
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

BACKUP_VOLUME="${PAVILLION_BACKUP_VOLUME:-pavillion-backups}"
BACKUP_DIR="${PAVILLION_BACKUP_DIR:-}"
DRILL_IMAGE="${PAVILLION_DRILL_IMAGE:-postgres:17}"
DRILL_TIMEOUT="${PAVILLION_DRILL_TIMEOUT:-90}"
MIGRATIONS_DIR="${PAVILLION_MIGRATIONS_DIR:-${REPO_ROOT}/migrations}"

# Upper bound on PAVILLION_DRILL_TIMEOUT. An hour is far longer than any real
# postgres start-up and short enough that a mistyped value cannot leave a
# container holding a copy of production alive overnight.
DRILL_TIMEOUT_MAX=3600

# The scratch database name. Deliberately not the production database name, so
# a mistyped connection string cannot resolve to anything real.
SCRATCH_DB="restore_drill"

# Tables whose emptiness in a live instance's backup means the dump is not
# what the operator thinks it is.
CORE_TABLES=(account calendar event)

CONTAINER_NAME=""
_CLEANED_UP=0
# Set when cleanup finished with the container still present. Read by on_exit,
# which turns it into exit code 3 so a passing drill that leaked a container is
# not reported to a monitor as an unqualified success.
_TEARDOWN_LEAKED=0

err() {
  echo "$@" >&2
}

# Prints the header comment block: it is this script's only documentation, so
# --help renders it rather than restating it out of sync.
usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^#[[:space:]]?/, ""); print; next } { exit }' "${BASH_SOURCE[0]}"
}

# Removes the drill container. Safe to call repeatedly and safe to call before
# the container exists, so a double signal cannot turn cleanup into an error.
cleanup_drill() {
  if (( _CLEANED_UP == 1 )); then
    return 0
  fi
  _CLEANED_UP=1
  if [[ -z "${CONTAINER_NAME}" ]]; then
    return 0
  fi

  # -v is load-bearing: the postgres image declares a VOLUME at PGDATA, so
  # every run creates an anonymous volume. Without -v the container goes but
  # the volume stays behind, one per drill.
  docker rm --force --volumes "${CONTAINER_NAME}" >/dev/null 2>&1 || true

  # A signal delivered between `docker run` returning and the daemon finishing
  # create+start can let the rm above fire before the container is registered,
  # in which case it removes nothing and the container appears a moment later.
  # Retry once before deciding the removal really failed.
  if [[ -n "$(drill_container_ids)" ]]; then
    sleep 2
    docker rm --force --volumes "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  fi

  # The exit status of `docker rm` is deliberately ignored — cleanup must never
  # be the thing that fails a drill — but a surviving container is not silent:
  # it is a running postgres holding a full unencrypted copy of the production
  # database, so the operator is told how to remove it by hand.
  if [[ -n "$(drill_container_ids)" ]]; then
    _TEARDOWN_LEAKED=1
    err ""
    err "WARNING: the drill container ${CONTAINER_NAME} could not be removed."
    err "         It still holds a full copy of the restored database. Remove it with:"
    err "           docker rm -fv ${CONTAINER_NAME}"
  fi
  return 0
}

# The EXIT trap. Tears the container down, then decides what the exit status
# should say about a teardown that did not work.
#
# A failed teardown is not a failed backup, so it does not turn a passing drill
# into exit 1 and does not retract the PASSED verdict on stdout. But it must not
# be reported as a plain 0 either: the drill is documented as a cron job, and an
# exit-code-driven monitor seeing 0 would record an unqualified success while a
# postgres container still holds a full unencrypted copy of production. So the
# leak gets its own code, and stdout's verdict is qualified on the way out.
on_exit() {
  local status=$?
  cleanup_drill
  if (( _TEARDOWN_LEAKED == 1 && status == 0 )); then
    err ""
    err "The drill itself PASSED — the backup restores. Exiting 3 rather than 0"
    err "because the scratch container above outlived the drill and still needs"
    err "removing by hand."
    exit 3
  fi
  exit "${status}"
}

# Reports the drill container's id if the daemon still knows about it. Anchored
# so a container whose name merely contains this one's cannot mask a leak.
drill_container_ids() {
  docker ps -aq --filter "name=^${CONTAINER_NAME}$" 2>/dev/null || true
}

on_signal() {
  err ""
  err "Interrupted. Removing the drill container."
  cleanup_drill
  exit 130
}

# Strips blank lines so an empty input is an empty set rather than a set
# containing the empty string.
normalize_list() {
  printf '%s\n' "$1" | sed '/^[[:space:]]*$/d'
}

# Builds the docker run volume argument for the backup source. The default
# mounts the named compose volume rather than its host path: the host bind
# (/opt/pavillion/backups) is mode 0750 owned by the container user, so a host
# path approach would need sudo, and would break for an operator who repointed
# the volume at non-bind storage. Mounting the volume keeps the only filesystem
# assumption to the volume name, which docker-compose.yml pins.
backup_mount_spec() {
  if [[ -n "${BACKUP_DIR}" ]]; then
    # A relative path passes the -d test below and then fails inside Docker
    # with an opaque mount error, because the daemon resolves it against its
    # own root rather than this shell's working directory.
    if [[ "${BACKUP_DIR}" != /* ]]; then
      err "Error: PAVILLION_BACKUP_DIR must be an absolute path: ${BACKUP_DIR}"
      return 1
    fi
    if [[ ! -d "${BACKUP_DIR}" ]]; then
      err "Error: backup directory not found: ${BACKUP_DIR}"
      return 1
    fi
    echo "${BACKUP_DIR}:/backup:ro"
    return 0
  fi

  if [[ -z "${BACKUP_VOLUME}" ]]; then
    err "Error: PAVILLION_BACKUP_VOLUME is empty. Set it to a docker volume name,"
    err "       or set PAVILLION_BACKUP_DIR to a host directory."
    return 1
  fi

  # This is a volume name, not a path. A value containing / silently becomes a
  # bind mount that the daemon creates as root; a value containing : rewrites
  # the mount options, including the :ro suffix. Both fail open, so reject them.
  if [[ "${BACKUP_VOLUME}" == */* || "${BACKUP_VOLUME}" == *:* ]]; then
    err "Error: PAVILLION_BACKUP_VOLUME must be a docker volume name, not a path: ${BACKUP_VOLUME}"
    err "       Use PAVILLION_BACKUP_DIR to drill a dump from a host directory."
    return 1
  fi

  echo "${BACKUP_VOLUME}:/backup:ro"
}

# Picks the newest dump from a directory listing. BackupService names files
# pavillion_YYYYMMDD_HHMMSS_<type>.dump, so a lexical sort is a chronological
# sort. Partial files written by an in-flight backup do not end in .dump and
# are therefore never selected.
select_newest_backup() {
  local listing="$1"
  local newest
  newest=$(normalize_list "${listing}" | grep -E '\.dump$' | LC_ALL=C sort | tail -n 1) || true
  if [[ -z "${newest}" ]]; then
    err "Error: no backup files found in the backup source."
    err "       Looked for *.dump. Check that backups have run, and that"
    err "       PAVILLION_BACKUP_VOLUME/PAVILLION_BACKUP_DIR point at them."
    return 1
  fi
  echo "${newest}"
}

# Resolves which dump to drill: the operator's choice if they named one,
# otherwise the newest. A requested name must be a bare filename inside the
# backup source — accepting a host path would invite drilling a file the
# container cannot see.
resolve_requested_backup() {
  local listing="$1"
  local requested="$2"

  if [[ -z "${requested}" ]]; then
    select_newest_backup "${listing}"
    return $?
  fi

  if [[ "${requested}" == */* ]]; then
    err "Error: expected a bare filename inside the backup source, not a path: ${requested}"
    return 1
  fi

  # -- so a requested name beginning with - is matched as a pattern rather than
  # read as a grep option.
  if ! normalize_list "${listing}" | grep -qxF -- "${requested}"; then
    err "Error: backup file not found in the backup source: ${requested}"
    return 1
  fi

  echo "${requested}"
}

# Lists the migration filenames the current checkout expects, counted at
# runtime rather than hardcoded so the check stays correct as migrations land.
# README.md and anything else non-.ts is excluded.
list_expected_migrations() {
  local dir="$1"
  local f
  local -a names=()

  if [[ ! -d "${dir}" ]]; then
    err "Error: migrations directory not found: ${dir}"
    return 1
  fi

  shopt -s nullglob
  for f in "${dir}"/*.ts; do
    names+=("$(basename "${f}")")
  done
  shopt -u nullglob

  if (( ${#names[@]} == 0 )); then
    err "Error: no migration files found in ${dir}"
    return 1
  fi

  printf '%s\n' "${names[@]}" | LC_ALL=C sort
}

# Compares the migrations on disk against the ones the dump recorded in
# "SequelizeMeta". Stored values include the .ts extension, which is why the
# expected set is basenames rather than stems.
#
# The comparison is SET EQUALITY, in both directions, and both directions are
# failures. Rationale: the drill's job is to answer "could I stand this
# instance back up from this dump", and the answer is no in either direction.
# A dump missing a migration predates the deployed schema and would restore an
# instance the current image cannot run. A dump carrying a migration the
# checkout does not have was taken from a newer image than the one on this
# host, so a restore here would silently downgrade. Both are real operator
# problems that deserve a stop, and the two cases are reported separately so
# the operator can tell which one they are looking at.
compare_migration_sets() {
  local expected applied missing extra

  expected=$(normalize_list "$1" | LC_ALL=C sort -u)
  applied=$(normalize_list "$2" | LC_ALL=C sort -u)

  missing=$(LC_ALL=C comm -23 <(printf '%s\n' "${expected}" | sed '/^$/d') <(printf '%s\n' "${applied}" | sed '/^$/d'))
  extra=$(LC_ALL=C comm -13 <(printf '%s\n' "${expected}" | sed '/^$/d') <(printf '%s\n' "${applied}" | sed '/^$/d'))

  if [[ -z "${missing}" && -z "${extra}" ]]; then
    return 0
  fi

  # Quoted and indented by sed rather than by printf's format-reuse: the extra
  # set comes from the dump's "SequelizeMeta" table, which is untrusted input
  # when drilling a foreign dump. Unquoted, a stored name of * would glob against
  # the working directory and a name with spaces would mis-split.
  err "FAIL: migration mismatch between the dump and migrations/"
  if [[ -n "${missing}" ]]; then
    err "      Applied in migrations/ but absent from the dump (dump predates this checkout):"
    printf '%s\n' "${missing}" | sed 's/^/        /' >&2
  fi
  if [[ -n "${extra}" ]]; then
    err "      Present in the dump but absent from migrations/ (dump is newer than this checkout):"
    printf '%s\n' "${extra}" | sed 's/^/        /' >&2
  fi
  return 1
}

# Confirms the restored schema has the tables a Pavillion database must have.
check_tables_present() {
  local present required missing=()
  present=$(normalize_list "$1")

  for required in "SequelizeMeta" "${CORE_TABLES[@]}"; do
    if ! printf '%s\n' "${present}" | grep -qxF -- "${required}"; then
      missing+=("${required}")
    fi
  done

  if (( ${#missing[@]} > 0 )); then
    err "FAIL: restored schema is missing expected tables: ${missing[*]}"
    return 1
  fi
  return 0
}

# Takes "table|count" lines and fails naming every empty core table, not just
# the first — an operator fixing one wants to see the rest in the same run.
#
# The test is "prove this count is a positive integer", not "prove it is the
# string 0". A silent pass is this script's worst possible outcome, so an empty
# or unparseable count — a query that failed, a truncated result — is a failure
# rather than a table scored as populated.
evaluate_core_table_counts() {
  local line table count empty=()

  while IFS= read -r line; do
    [[ -z "${line}" ]] && continue
    table="${line%%|*}"
    count="${line##*|}"
    if [[ ! "${count}" =~ ^[1-9][0-9]*$ ]]; then
      empty+=("${table}")
    fi
  done <<< "$(normalize_list "$1")"

  if (( ${#empty[@]} > 0 )); then
    err "FAIL: core tables are empty or unreadable in the restored database: ${empty[*]}"
    err "      An empty ${empty[0]} table in a live instance's backup means the"
    err "      dump does not hold the data the operator expects."
    return 1
  fi
  return 0
}

# Reduces pg_restore's own output to the part that is safe to print.
#
# What this guarantees: the operator sees which pg_restore operation failed —
# the verb and the table or archive member — and never a value that came out of
# the dump. It does NOT get that from the line-prefix filter alone, because a
# "pg_restore: error:" line is not self-limiting. pg_restore prepends its own
# prefix to the whole PostgreSQL server message, and that message quotes the
# offending value INLINE, on the error line itself, with no labelled clause
# after it to strip. Verified against a real postgres:17:
#
#   pg_restore: error: COPY failed for table "account": ERROR:  invalid input
#     syntax for type integer: "multi@example.com"
#
# and identically for uuid, for "value too long for type character varying(n)",
# and for "invalid byte sequence for encoding". Those are precisely the failures
# a corrupt, truncated, or mismatched dump produces — the class this drill
# exists to provoke — so an allow-list of line prefixes is not a redaction.
#
# THE RULE IS COARSE, AND DELIBERATELY SO. Two earlier versions tried to keep
# more of the message by locating where the row value began: first by truncating
# at a whitespace-preceded ALL-CAPS severity label, then by matching the quotes
# around the value. Both were defeated, because both parsed a message written in
# a language this script does not control:
#
#   - The severity label embedded in the message is the SERVER's, printed in the
#     server's lc_messages, which is fixed when the postmaster starts from the
#     image's baked-in LANG. `docker exec --env LC_ALL=C` sets pg_restore's own
#     client-side catalog and nothing else; no client-side variable can
#     retroactively change an already-running server's message language. A
#     zh_CN.utf8 image says "错误:", which has no case distinction for an
#     ALL-CAPS rule to key on at all, and a de/fr/ru image can quote a value
#     with »…« or « … » rather than "…".
#   - PostgreSQL does not escape a double quote inside the value it quotes back,
#     so a "[^"]*" pairing stops at the first embedded quote and leaves the rest
#     of the value in the log. Any free-text, name or email field containing a "
#     de-syncs it. So does a value long enough to wrap, whose closing quote
#     lands on a physical line the line filter drops.
#
# So this parses no part of the message body. On a retained line it keeps the
# text up to the FIRST colon that follows the "pg_restore: error: " prefix — the
# operation and the table or archive member it names — and replaces everything
# from that colon onward with [redacted], unconditionally. Nothing about the
# server's message language, its quoting glyphs, its capitalisation or its
# escaping can change what is kept, because none of it is consulted. A table
# name whose own text contains a colon simply gets cut short: that direction of
# error redacts more, not less.
#
# The rule is TWO substitutions and a branch, and the branch is what makes it
# fail closed:
#
#   s/^(pg_restore: error: [^:]*):.*$/\1: [redacted]/
#   t
#   s/^.*$/pg_restore: error: [redacted]/
#
# `t` branches to the end of the script when the first substitution fired, so
# the second one only ever sees a line the first did not match — a line with no
# colon after the prefix, or one whose prefix is not the "error: " shape at all.
# Such a line loses everything, including whatever prefix shape it arrived with,
# and is reissued as the fixed string. THIS IS THE CATCH-ALL, and it is not
# optional decoration: an earlier version had a second anchored substitution
# here instead, so a line matching neither rule — `pg_restore: error:COPY
# failed: <value>`, with no space after the prefix, or with a tab there — was
# emitted verbatim after passing the (space-less) line filter. That is not a
# shape real pg_restore can produce; it is a shape a ROW VALUE can produce, via
# the injection described below. With the catch-all, anything reaching this
# function's sed leaves it as one of exactly two shapes, so the default really
# is redact rather than pass through.
#
# LINE INJECTION FROM A ROW VALUE. PostgreSQL does not escape an embedded
# newline when it quotes a row value back into an error message, and pg_restore
# does not re-prefix the continuation lines. A stored value containing newlines
# therefore injects attacker-chosen PHYSICAL LINES into this stream, and such a
# line may carry the "pg_restore: error:" prefix itself, so the line filter is
# no defence against it. It is the reason the catch-all above matters, and the
# reason the allow-list below is gated on position.
#
# The one exception to the redaction is an ALLOW-LIST of archive-level
# diagnostics, matched as fully-anchored exact strings. pg_restore emits these
# before it reads any table's data, so they carry no row value, and they are the
# operator's entire diagnosis when the archive itself is the problem — a
# truncated file, a non-archive, a bad header — which the drill's acceptance
# criteria require it to be able to name. Matching one means the line IS that
# literal text, so there is nowhere in it for a value to hide.
#
# But a row value can REPRODUCE one of those literals byte for byte on an
# injected line, and an exemption keyed on the text alone would then hand the
# operator a false "truncated archive" diagnosis for what was really a row or
# type error. Verified live against postgres:17. So the exemption is gated on
# POSITION as well as text: a genuine archive-level failure is the only error
# pg_restore emits, and never co-occurs with a table-scoped "COPY failed for
# table" line. A literal is therefore exempt only when it is the FIRST surviving
# line of a batch that contains no "COPY failed for table" line anywhere — which
# an injected line cannot be, because the COPY error whose message carried it
# always precedes it. Off the allow-list, such a line is redacted like any
# other, so a forgery still costs the attacker the ": [redacted]" that a genuine
# diagnostic does not carry.
#
# The cheap bounds around all of that, none of which has ever been defeated:
# only "pg_restore: error:" lines are kept at all (which is also what drops
# DETAIL:/CONTEXT:, since real pg_restore puts them on their own physical
# lines, along with progress chatter), at most 20 lines, at most 200 bytes each.
#
# LC_ALL=C here is byte semantics for the host's own grep/sed/cut, not a
# language assumption: a corrupt dump can put invalid UTF-8 into this text, and
# a multibyte locale can refuse to match a line containing it — on BSD sed an
# unpinned substitution given invalid UTF-8 aborts with "RE error: illegal byte
# sequence" and passes the line through UNMODIFIED, which is a fail-open. It is
# on every command in the pipeline for that reason, the indent included, even
# where the current regex would not evaluate a character class.
#
# The 200-byte bound is bytes, not characters, so a kept prefix longer than that
# can be cut mid-UTF-8-sequence and emit an invalid byte. That is cosmetic and
# deliberately left alone: redaction has already run by then, so the only text
# the cut can mangle is the operation and table name this rule chose to keep,
# and no row value can be exposed by splitting it. Widening the bound to count
# characters would mean interpreting the encoding of untrusted text, which is
# the class of thing this function exists to avoid.
#
# The output is safe to paste into an issue in the sense that matters: it names
# operations and table names, never a row value. One residue remains, and it is
# a spoofing risk rather than a disclosure one — on an injected line, the text
# before the first colon is attacker-chosen, so a hostile dump can put a short
# string of its choosing where an operation name normally sits.
redact_restore_output() {
  local kept exemptions=''
  # The line filter and the 20-line cap run first and their result is held,
  # because the allow-list gate below is a property of the surviving BATCH
  # rather than of any line read on its own.
  kept=$(printf '%s\n' "$1" | LC_ALL=C grep '^pg_restore: error:' | head -n 20) || true
  if [[ -z "${kept}" ]]; then
    return 0
  fi

  # `1{...}` is the position half of the gate and the absent "COPY failed for
  # table" is the co-occurrence half; when either fails the block is simply not
  # part of the script and every line goes through the redaction below.
  if ! printf '%s\n' "${kept}" | LC_ALL=C grep -qF 'COPY failed for table'; then
    exemptions='1{
/^pg_restore: error: could not read from input file: end of file$/b
/^pg_restore: error: did not find magic string in file header$/b
/^pg_restore: error: (input file )?does not appear to be a valid archive \(too short\?\)$/b
}
'
  fi

  printf '%s\n' "${kept}" \
    | LC_ALL=C sed -E "${exemptions}"'
s/^(pg_restore: error: [^:]*):.*$/\1: [redacted]/
t
s/^.*$/pg_restore: error: [redacted]/
' \
    | LC_ALL=C cut -c 1-200 \
    | LC_ALL=C sed 's/^/        /'
}

# Validates the two settings that leave the environment and reach a context
# where a non-value is more than a bad value.
#
# PAVILLION_DRILL_TIMEOUT reaches a bash arithmetic context in
# wait_for_scratch_db. Arithmetic evaluation is recursive, and an array
# subscript inside it is itself evaluated, so a value like
# 'waited[$(some-command)]' executes that command. set -u blocks the naive
# payload but not one naming a variable that is in scope. That matters here
# because the drill is documented as a cron job: whoever can write a systemd
# EnvironmentFile, without being able to touch this script, would otherwise get
# execution as a user who can reach the Docker socket.
#
# PAVILLION_DRILL_IMAGE lands in the option-parsing region of a docker run, so a
# leading dash is read as a flag rather than an image. It is passed as argv, so
# this is not injection — but it is the same class of unvalidated input, and the
# guard is a line.
validate_drill_settings() {
  if [[ ! "${DRILL_TIMEOUT}" =~ ^[0-9]+$ ]]; then
    err "Error: PAVILLION_DRILL_TIMEOUT must be a whole number of seconds: ${DRILL_TIMEOUT}"
    return 1
  fi
  if (( 10#${DRILL_TIMEOUT} == 0 )); then
    err "Error: PAVILLION_DRILL_TIMEOUT must be at least 1 second."
    return 1
  fi
  # The digit-count test is not decoration: bash arithmetic is 64-bit and wraps,
  # so a 20-digit value compared against the cap can come out negative and pass.
  # Bounding the length first is what makes the numeric comparison mean anything.
  # A too-large value is rejected rather than clamped — silently drilling for an
  # hour when the operator asked for a year is its own surprise.
  if (( ${#DRILL_TIMEOUT} > 4 )) || (( 10#${DRILL_TIMEOUT} > DRILL_TIMEOUT_MAX )); then
    err "Error: PAVILLION_DRILL_TIMEOUT must be at most ${DRILL_TIMEOUT_MAX} seconds: ${DRILL_TIMEOUT}"
    err "       The scratch container holds a full copy of production while it waits."
    return 1
  fi
  if [[ -z "${DRILL_IMAGE}" ]]; then
    err "Error: PAVILLION_DRILL_IMAGE is empty. Set it to a Postgres image reference."
    return 1
  fi
  if [[ "${DRILL_IMAGE}" == -* ]]; then
    err "Error: PAVILLION_DRILL_IMAGE must be an image reference, not an option: ${DRILL_IMAGE}"
    return 1
  fi
  return 0
}

# --- Docker-dependent phases -------------------------------------------------

# Every command the drill runs inside the scratch container goes through here.
#
# LC_ALL=C pins the CLIENT-side message catalog of the tool being exec'd, so
# pg_restore's own prefix is the ASCII "pg_restore: error:" that
# redact_restore_output's line filter keys on, rather than a translated one, on
# every image an operator can point PAVILLION_DRILL_IMAGE at. That is the whole of
# what it buys, and redaction does not depend on it: it does NOT reach the severity
# label or the quoting glyphs inside the message body, because those are the
# SERVER's, printed in its lc_messages, fixed when the postmaster started from the
# image's baked-in LANG — no client-side variable can change an already-running
# server's message language. redact_restore_output therefore assumes nothing about
# the message body and does not parse it at all; see its header. This pin is a
# cheap stabiliser for the line filter, not the reason the redaction holds.
# It is applied to every exec rather than to pg_restore alone: the psql calls'
# diagnostics reach the operator too, one of them deliberately unfiltered, and one
# pinned wrapper is one invariant to hold rather than two paths to keep in step.
#
# --env carries a constant, never a credential. The value is on the docker command
# line, which is fine for a locale and is exactly why POSTGRES_PASSWORD is passed by
# name to docker run instead and never appears here.
drill_exec() {
  docker exec --env LC_ALL=C "${CONTAINER_NAME}" "$@"
}

drill_psql() {
  # -At: unaligned, tuples only. ON_ERROR_STOP turns any SQL error into a
  # non-zero exit rather than a silent empty result.
  drill_exec psql -v ON_ERROR_STOP=1 -qAt -U postgres -d "$1" -c "$2"
}

wait_for_scratch_db() {
  local waited=0
  # Revalidated here, not just in main(), because this is the function that puts
  # DRILL_TIMEOUT into an arithmetic context — so the guard lives with the
  # hazard rather than depending on a caller having run it first.
  validate_drill_settings || return 1
  # 10# to match the validator. Without it the two arithmetic sites disagree
  # about the same string: the validator reads 010 as ten and this loop would
  # read it as eight, and 008 would abort here with a raw bash "value too great
  # for base" after the validator had already called it acceptable.
  while (( waited < 10#${DRILL_TIMEOUT} )); do
    if drill_exec pg_isready -q -U postgres >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done
  err "FAIL: the scratch database did not accept connections within ${DRILL_TIMEOUT}s."
  return 1
}

main() {
  local requested="" listing backup mount_spec expected applied present counts restore_output
  local -a failures=()

  case "${1:-}" in
    --help|-h)
      usage
      return 0
      ;;
    -*)
      err "Error: unknown option: $1"
      err "Run ./scripts/restore-drill.sh --help for usage."
      return 1
      ;;
    *)
      requested="${1:-}"
      ;;
  esac

  if ! command -v docker >/dev/null 2>&1; then
    err "Error: docker is not on PATH. The drill needs Docker to create its scratch database."
    return 1
  fi

  validate_drill_settings || return 1

  mount_spec=$(backup_mount_spec) || return 1

  # The trap is installed before the container is created so that an interrupt
  # during docker run still tears down whatever was started.
  trap on_exit EXIT
  trap on_signal INT TERM

  CONTAINER_NAME="pavillion-restore-drill-$$-${RANDOM}"

  # Generated per run, exported so docker run can take it by name. It is never
  # written to a command line, so it cannot appear in `ps` output or in shell
  # history, and it is never printed.
  POSTGRES_PASSWORD="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  export POSTGRES_PASSWORD

  echo "Pavillion restore drill"
  echo "  image:     ${DRILL_IMAGE}"
  echo "  source:    ${mount_spec}"
  echo "  container: ${CONTAINER_NAME}"
  echo ""

  echo "Starting the throwaway database..."
  # pg_restore runs the archive's SQL as the scratch superuser, and a -Fc archive
  # can carry COPY ... FROM PROGRAM, so the container is treated as if the dump
  # were hostile. Code execution inside the container is the assumed starting
  # point, which is exactly when the capability set left to it decides how far
  # that goes — so it is dropped to the three the postgres entrypoint actually
  # needs: SETGID and SETUID for the gosu from root to postgres, and
  # DAC_OVERRIDE for the PGDATA permissions it fixes up on the way. That leaves
  # ~11 defaults dropped, CAP_MKNOD, CAP_SYS_CHROOT, CAP_NET_RAW, CAP_SETFCAP
  # and CAP_SETPCAP among them. Verified end to end against postgres:17: the
  # container starts, and createdb, pg_dump -Fc, pg_restore and the verification
  # queries all succeed under it.
  if ! docker run \
    --detach \
    --rm \
    --name "${CONTAINER_NAME}" \
    --network none \
    --cap-drop ALL \
    --cap-add DAC_OVERRIDE \
    --cap-add SETGID \
    --cap-add SETUID \
    --security-opt no-new-privileges \
    --pids-limit 512 \
    --memory 2g \
    --env POSTGRES_PASSWORD \
    --env POSTGRES_DB=postgres \
    --volume "${mount_spec}" \
    "${DRILL_IMAGE}" >/dev/null; then
    err "FAIL: could not start the scratch database container."
    return 1
  fi

  # The container has the password now, and verification connects over its unix
  # socket, so nothing on this side needs the value again. This is not what keeps
  # it out of the container's later exec sessions — the only --env drill_exec
  # passes is the LC_ALL=C locale pin, so docker exec was never forwarding the
  # password. It shortens the value's lifetime in this
  # script's own process instead, so it is not sitting in the environment of
  # everything main() shells out to for the rest of the run.
  unset POSTGRES_PASSWORD

  wait_for_scratch_db || return 1

  echo "Locating the backup..."
  if ! listing=$(drill_exec sh -c 'ls -1 /backup 2>/dev/null'); then
    err "Error: could not read the backup source mounted at /backup."
    err "       Check that ${mount_spec%%:*} exists and holds the backups."
    return 1
  fi

  backup=$(resolve_requested_backup "${listing}" "${requested}") || return 1
  echo "  drilling: ${backup}"
  echo ""

  echo "Restoring into the scratch database..."
  if ! drill_exec createdb -U postgres "${SCRATCH_DB}" >/dev/null 2>&1; then
    err "FAIL: could not create the scratch database ${SCRATCH_DB} in the container."
    return 1
  fi

  # No -c: the target is a database created moments ago, so there is nothing to
  # drop. --exit-on-error makes any restore error fatal rather than leaving the
  # operator to judge an ignorable-vs-fatal line for themselves.
  #
  # The child's output is CAPTURED, not inherited, and passes through
  # redact_restore_output before any of it reaches a terminal or a cron log.
  if ! restore_output=$(drill_exec pg_restore \
    --username postgres \
    --dbname "${SCRATCH_DB}" \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "/backup/${backup}" 2>&1); then
    err "FAIL: pg_restore could not restore ${backup} into the scratch database."
    err "      The dump is corrupt, truncated, or not a pg_dump -Fc archive."
    err "      pg_restore reported:"
    redact_restore_output "${restore_output}" >&2 || true
    return 1
  fi
  echo "  restore completed"
  echo ""

  echo "Checking the restored database..."

  # stderr is left visible on this query alone: it has no fallback value, so its
  # own error text is the operator's only diagnosis. What it can print is psql's
  # connection and syntax diagnostics for a query whose result set is table
  # names from the catalog — unlike pg_restore's COPY failures, there is no row
  # value for the server to quote back here. The two queries below suppress
  # stderr because each falls back to a value the checks treat as a failure.
  if ! present=$(drill_psql "${SCRATCH_DB}" \
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;"); then
    err "FAIL: could not list the tables in the restored database."
    return 1
  fi
  if check_tables_present "${present}"; then
    echo "  PASS  schema present"
  else
    failures+=("schema present")
  fi

  expected=$(list_expected_migrations "${MIGRATIONS_DIR}") || return 1
  # "SequelizeMeta" must stay double-quoted: unquoted, Postgres folds it to
  # sequelizemeta and the query errors.
  applied=$(drill_psql "${SCRATCH_DB}" 'SELECT name FROM "SequelizeMeta" ORDER BY name;' 2>/dev/null) || applied=""
  if compare_migration_sets "${expected}" "${applied}"; then
    echo "  PASS  migrations consistent ($(normalize_list "${expected}" | wc -l | tr -d ' ') migrations)"
  else
    failures+=("migrations consistent")
  fi

  counts=""
  local table count
  for table in "${CORE_TABLES[@]}"; do
    count=$(drill_psql "${SCRATCH_DB}" "SELECT count(*) FROM \"${table}\";" 2>/dev/null) || count="0"
    counts+="${table}|${count}"$'\n'
  done

  if evaluate_core_table_counts "${counts}"; then
    echo "  PASS  core tables non-empty"
  else
    failures+=("core tables non-empty")
  fi

  echo ""
  echo "Row counts:"
  while IFS='|' read -r table count; do
    [[ -z "${table}" ]] && continue
    printf '  %-12s %s\n' "${table}" "${count}"
  done <<< "$(normalize_list "${counts}")"

  echo ""
  if (( ${#failures[@]} > 0 )); then
    err "RESTORE DRILL FAILED: ${#failures[@]} check(s) failed: ${failures[*]}"
    return 1
  fi

  echo "RESTORE DRILL PASSED for ${backup}"
  echo ""
  echo "Note: this drill covers the database only. Pavillion's backup system"
  echo "runs pg_dump and produces no media archive, so media backup remains"
  echo "an operator-owned volume snapshot and is not verified here."
  return 0
}

if (( __DRILL_EXECUTED == 1 )); then
  main "$@"
fi
