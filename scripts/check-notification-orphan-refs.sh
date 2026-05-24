#!/usr/bin/env bash
#
# check-notification-orphan-refs.sh
#
# Orphan-reference gate for the notifications domain redesign.
#
# The migration replaced the old single-table NotificationEntity with the
# two-table NotificationActivityEntity + NotificationRecipientEntity model
# and renamed several columns:
#
#   - class:  NotificationEntity        -> NotificationActivityEntity
#   - column: type (notification field) -> verb
#   - column: actor_url                 -> actor_display_url (snapshot)
#   - column: actor_name                -> actor_display_name (snapshot)
#
# This script greps the non-test, non-migration source tree for any lingering
# references to the old names and fails the build with a clear pointer if it
# finds any. It is a one-shot guard: once the migration ships clean, this
# catches future drift.
#
# Excluded by design:
#   - src/**/test/**            (round-trip and historical tests may still
#                                mention the old names in comments / fixtures)
#   - src/**/migrations/**      (migrations encode the schema transition and
#                                legitimately reference both schemas)
#   - this script itself        (it has to spell the forbidden names out)
#
# Exit codes:
#   0 -> clean
#   1 -> at least one forbidden reference found
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="${REPO_ROOT}/src"

if [ ! -d "${SRC_DIR}" ]; then
  echo "check-notification-orphan-refs: src/ not found at ${SRC_DIR}" >&2
  exit 1
fi

# Patterns to forbid. Each pattern is an extended-regex matched line-by-line.
# Notes:
#   - The notification.type / Notification.type patterns target the old field
#     name on the notification model only. A bare "type" grep would match
#     half the codebase, so we scope to the dotted-access form against a
#     notification-shaped identifier. This is narrow but catches the
#     realistic drift case (`notification.type`, `Notification.type`,
#     `newNotification.type`, etc.).
#   - actor_url / actor_name are unique enough as column-name strings that
#     a plain identifier grep is safe outside test/migration paths.
PATTERNS=(
  '\bNotificationEntity\b'
  '\bactor_url\b'
  '\bactor_name\b'
  '[Nn]otification\.type\b'
)

# Build the exclusion list. We rely on grep --exclude-dir to skip whole
# directory names anywhere in the path; the test/ and migrations/ folders
# live under each domain (e.g. src/server/notifications/test/, ...).
EXCLUDES=(
  --exclude-dir=test
  --exclude-dir=tests
  --exclude-dir=migrations
  --exclude-dir=node_modules
  --exclude-dir=dist
  --exclude-dir=build
)

found_any=0
echo "check-notification-orphan-refs: scanning ${SRC_DIR} ..."

for pattern in "${PATTERNS[@]}"; do
  # -n line numbers, -r recursive, -E extended regex, -I skip binaries.
  # Capture matches to a buffer so we can report them at the end if any.
  set +e
  matches="$(grep -rnIE "${EXCLUDES[@]}" "${pattern}" "${SRC_DIR}" 2>/dev/null)"
  rc=$?
  set -e

  if [ "${rc}" -eq 0 ] && [ -n "${matches}" ]; then
    found_any=1
    echo ""
    echo "FORBIDDEN PATTERN: ${pattern}"
    echo "${matches}"
  fi
done

if [ "${found_any}" -ne 0 ]; then
  cat <<'EOF'

------------------------------------------------------------------------
check-notification-orphan-refs: FAILED.

The notifications domain was migrated to a two-table activity/recipient
model. The names above belong to the old schema and must not appear in
non-test, non-migration source.

See:
  src/server/notifications/entity/notification_activity.ts
  src/server/notifications/entity/notification_recipient.ts

Replacements:
  NotificationEntity   -> NotificationActivityEntity (+ NotificationRecipientEntity)
  type   (field)       -> verb
  actor_url            -> actor_display_url
  actor_name           -> actor_display_name
------------------------------------------------------------------------
EOF
  exit 1
fi

echo "check-notification-orphan-refs: OK"
exit 0
