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
#                             connections. Default: 90
#   PAVILLION_MIGRATIONS_DIR  Directory holding the migration files the dump is
#                             compared against. Default: <repo>/migrations
#
# Examples:
#   ./scripts/restore-drill.sh
#   ./scripts/restore-drill.sh pavillion_20260315_020000_scheduled.dump
#   PAVILLION_BACKUP_DIR=/tmp/dumps ./scripts/restore-drill.sh
#
# Exit codes:
#   0  every check passed
#   1  a check failed, or a prerequisite was missing; the reason is on stderr
#   130  interrupted (SIGINT/SIGTERM); the container is torn down first
#
# Safety properties, all of them mechanically visible in the docker run below:
#   - The scratch container runs with --network none, so it cannot reach the
#     compose project network or the live db service even by accident.
#   - The backup source is mounted at /backup with an explicit :ro suffix, so
#     the drill cannot modify or delete a backup.
#   - pg_restore executes the archive's SQL as the scratch superuser, and the
#     archive may come from outside this deployment, so the container is
#     additionally capped with --security-opt no-new-privileges, --pids-limit
#     and --memory. A hostile archive gets no network, a read-only view of the
#     backups, and a bounded, disposable container.
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

# The scratch database name. Deliberately not the production database name, so
# a mistyped connection string cannot resolve to anything real.
SCRATCH_DB="restore_drill"

# Tables whose emptiness in a live instance's backup means the dump is not
# what the operator thinks it is.
CORE_TABLES=(account calendar event)

CONTAINER_NAME=""
_CLEANED_UP=0

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
    err ""
    err "WARNING: the drill container ${CONTAINER_NAME} could not be removed."
    err "         It still holds a full copy of the restored database. Remove it with:"
    err "           docker rm -fv ${CONTAINER_NAME}"
  fi
  return 0
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
# pg_restore's "pg_restore: error:" lines name the failing operation — which
# table, which archive member — and nothing else. The CONTEXT: and DETAIL:
# lines Postgres appends to them quote the offending row verbatim
# ("DETAIL: Key (email)=(someone@example.com) already exists"), and those are
# exactly the failures a restore drill provokes. This is a monthly cron job, so
# that text would land in a log; only the operation names are echoed, capped so
# a dump with thousands of bad rows cannot flood the report either.
redact_restore_output() {
  printf '%s\n' "$1" \
    | grep '^pg_restore: error:' \
    | sed -E 's/(DETAIL|CONTEXT):.*//' \
    | head -n 20 \
    | sed 's/^/        /'
}

# --- Docker-dependent phases -------------------------------------------------

drill_exec() {
  docker exec "${CONTAINER_NAME}" "$@"
}

drill_psql() {
  # -At: unaligned, tuples only. ON_ERROR_STOP turns any SQL error into a
  # non-zero exit rather than a silent empty result.
  drill_exec psql -v ON_ERROR_STOP=1 -qAt -U postgres -d "$1" -c "$2"
}

wait_for_scratch_db() {
  local waited=0
  while (( waited < DRILL_TIMEOUT )); do
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

  mount_spec=$(backup_mount_spec) || return 1

  # The trap is installed before the container is created so that an interrupt
  # during docker run still tears down whatever was started.
  trap cleanup_drill EXIT
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
  # --security-opt/--pids-limit/--memory: pg_restore runs the archive's SQL as
  # the scratch superuser, and a -Fc archive can carry COPY ... FROM PROGRAM, so
  # the container is treated as if the dump were hostile. --cap-drop ALL is
  # deliberately absent: the postgres entrypoint gosu's from root to postgres
  # and needs CAP_SETUID/CAP_SETGID to do it.
  if ! docker run \
    --detach \
    --rm \
    --name "${CONTAINER_NAME}" \
    --network none \
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
  # socket, so nothing on this side needs the value again. Dropping it here keeps
  # it out of every subsequent docker exec client's environment.
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
  # own error text is the operator's only diagnosis, and a pg_tables listing
  # cannot echo row data. The two queries below suppress stderr because each
  # falls back to a value the checks below treat as a failure.
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
