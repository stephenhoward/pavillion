#!/usr/bin/env bash
#
# Fixture-driven tests for the bead-branch-and-pr skill.
#
# Each test stubs the bead CLI via BD_SHOW_CMD="cat fixture.json" — the
# second arg to the stub (the bead id) is ignored, so the fixture JSON
# is returned regardless. This keeps the tests fully offline and
# deterministic.
#
# Usage: ./run-tests.sh
# Exit 0 if all tests pass, 1 otherwise.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$HERE/.." && pwd)"
FIXTURES="$HERE/fixtures"

PASS=0
FAIL=0
FAILED_TESTS=()

# Stub that ignores its args and prints the pre-selected fixture file.
stub_cmd() {
  local fixture_path="$1"
  # When BD_SHOW_CMD is expanded, it becomes: cat <fixture> <id>
  # cat will try to read <id> as a file and fail. Use a wrapper script
  # instead that ignores all args.
  cat <<EOF > "$HERE/.stub.sh"
#!/usr/bin/env bash
cat "$fixture_path"
EOF
  chmod +x "$HERE/.stub.sh"
  printf '%s\n' "$HERE/.stub.sh"
}

assert_eq() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if [ "$expected" = "$actual" ]; then
    PASS=$((PASS + 1))
    printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
    printf '  FAIL  %s\n' "$name"
    printf '    expected: %q\n' "$expected"
    printf '    actual:   %q\n' "$actual"
  fi
}

assert_contains() {
  local name="$1"
  local needle="$2"
  local haystack="$3"
  if printf '%s' "$haystack" | grep -Fq -- "$needle"; then
    PASS=$((PASS + 1))
    printf '  PASS  %s\n' "$name"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
    printf '  FAIL  %s  (missing: %s)\n' "$name" "$needle"
    printf '    haystack: %s\n' "$haystack"
  fi
}

assert_exit() {
  local name="$1"
  local expected_code="$2"
  local actual_code="$3"
  assert_eq "$name" "$expected_code" "$actual_code"
}

assert_lte() {
  local name="$1"
  local limit="$2"
  local value="$3"
  if [ "$value" -le "$limit" ]; then
    PASS=$((PASS + 1))
    printf '  PASS  %s  (%d <= %d)\n' "$name" "$value" "$limit"
  else
    FAIL=$((FAIL + 1))
    FAILED_TESTS+=("$name")
    printf '  FAIL  %s  (%d > %d)\n' "$name" "$value" "$limit"
  fi
}

# ============================================================
# branch-name.sh
# ============================================================
echo "== branch-name.sh =="

STUB="$(stub_cmd "$FIXTURES/task.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-9cfj.3)"
# The long fixture title is truncated to fit the 60-char budget while
# preserving as many leading words as possible; the exact suffix may
# land on a hyphen boundary which the script trims.
assert_eq "task -> chore/ prefix" \
  "chore/build-bead-branch-and-pr-skill-with-git-and-pv-9cfj-3" \
  "$actual"
assert_lte "task branch under 60 chars" 60 "${#actual}"

STUB="$(stub_cmd "$FIXTURES/feature.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-abcd)"
assert_eq "feature -> feat/ prefix" \
  "feat/add-event-external-url-field-pv-abcd" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/bug.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-xxxx)"
assert_eq "bug -> fix/ prefix" \
  "fix/widget-embed-snippet-stub-isn-t-callable-pv-xxxx" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/epic.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-9cfj)"
assert_contains "epic -> feat/ prefix" "feat/" "$actual"

STUB="$(stub_cmd "$FIXTURES/weird-title.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-weird)"
# All non-alnum chars must collapse into single hyphens.
assert_contains "weird chars normalised" "fix/fix-don-t-break-alice-s-slash-underscore-thing" "$actual"
# Branch should contain no slashes after the prefix segment.
slashes="$(printf '%s' "$actual" | tr -cd '/' | wc -c | tr -d ' ')"
assert_eq "weird title one slash" "1" "$slashes"

STUB="$(stub_cmd "$FIXTURES/long-title.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-long)"
assert_lte "long title branch under 60 chars" 60 "${#actual}"
assert_contains "long title preserves prefix" "chore/" "$actual"
assert_contains "long title preserves id" "-pv-long" "$actual"

# Determinism: run the same input twice and compare.
STUB="$(stub_cmd "$FIXTURES/task.json")"
a="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-9cfj.3)"
b="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-9cfj.3)"
assert_eq "deterministic output" "$a" "$b"

# Type override.
STUB="$(stub_cmd "$FIXTURES/task.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/branch-name.sh" pv-9cfj.3 --type-override=feat)"
assert_contains "type override respected" "feat/" "$actual"

# Missing bead id -> exit 2.
set +e
"$SKILL_DIR/branch-name.sh" >/dev/null 2>&1
ec=$?
set -e
assert_exit "missing id exits 2" 2 "$ec"

# ============================================================
# commit-msg.sh
# ============================================================
echo
echo "== commit-msg.sh =="

STUB="$(stub_cmd "$FIXTURES/task.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-9cfj.3 "add bead-branch-and-pr skill")"
assert_eq "task -> chore type, no scope" \
  "chore: add bead-branch-and-pr skill (pv-9cfj.3)" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/task.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-9cfj.3 "add bead-branch-and-pr skill" skills)"
assert_eq "task -> chore with scope" \
  "chore(skills): add bead-branch-and-pr skill (pv-9cfj.3)" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/feature.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-abcd "add external URL field" events)"
assert_eq "feature -> feat with scope" \
  "feat(events): add external URL field (pv-abcd)" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/bug.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-xxxx "make stub callable" widget-sdk)"
assert_eq "bug -> fix with scope" \
  "fix(widget-sdk): make stub callable (pv-xxxx)" \
  "$actual"

STUB="$(stub_cmd "$FIXTURES/feature.json")"
# Summary with embedded newline and extra whitespace should be flattened.
multiline="add external URL field
and update tests"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-abcd "$multiline" events)"
assert_eq "multi-line summary flattened" \
  "feat(events): add external URL field and update tests (pv-abcd)" \
  "$actual"

# Always includes (pv-xxxx) suffix.
STUB="$(stub_cmd "$FIXTURES/bug.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/commit-msg.sh" pv-xxxx "summary" s)"
assert_contains "commit msg includes id suffix" "(pv-xxxx)" "$actual"

# Missing args -> exit 2.
set +e
"$SKILL_DIR/commit-msg.sh" >/dev/null 2>&1
ec=$?
set -e
assert_exit "commit-msg missing args exits 2" 2 "$ec"

set +e
"$SKILL_DIR/commit-msg.sh" pv-xxxx >/dev/null 2>&1
ec=$?
set -e
assert_exit "commit-msg missing summary exits 2" 2 "$ec"

# ============================================================
# pr-body.sh
# ============================================================
echo
echo "== pr-body.sh =="

# Single-bead case.
STUB="$(stub_cmd "$FIXTURES/task.json")"
actual="$(BD_SHOW_CMD="$STUB" "$SKILL_DIR/pr-body.sh" pv-9cfj.3)"
assert_contains "single bead has Summary" "## Summary" "$actual"
assert_contains "single bead has Beads closed" "## Beads closed" "$actual"
assert_contains "single bead has Test plan" "## Test plan" "$actual"
assert_contains "single bead lists id" "- pv-9cfj.3 - Build bead-branch-and-pr skill with git and PR scripts" "$actual"
assert_contains "single bead summary uses title" "Build bead-branch-and-pr skill" "$actual"
assert_contains "single bead test plan lint" "npm run lint" "$actual"
assert_contains "single bead test plan unit" "npm run test:unit" "$actual"

# Epic-closing / multi-bead case: use two real fixtures. The stub is
# per-call, so we need a router stub that returns a different fixture
# depending on the requested id.
cat <<EOF > "$HERE/.multistub.sh"
#!/usr/bin/env bash
# Router stub: map bead id -> fixture file.
case "\$1" in
  pv-9cfj.3) cat "$FIXTURES/task.json" ;;
  pv-abcd)   cat "$FIXTURES/feature.json" ;;
  pv-xxxx)   cat "$FIXTURES/bug.json" ;;
  *) echo "unknown bead: \$1" >&2; exit 3 ;;
esac
EOF
chmod +x "$HERE/.multistub.sh"

actual="$(BD_SHOW_CMD="$HERE/.multistub.sh" "$SKILL_DIR/pr-body.sh" pv-9cfj.3 pv-abcd pv-xxxx)"
assert_contains "multi bead lists primary" "pv-9cfj.3" "$actual"
assert_contains "multi bead lists second" "pv-abcd - Add event external URL field" "$actual"
assert_contains "multi bead lists third" "pv-xxxx - Widget embed snippet stub isn't callable" "$actual"

# Determinism.
a="$(BD_SHOW_CMD="$HERE/.multistub.sh" "$SKILL_DIR/pr-body.sh" pv-9cfj.3 pv-abcd)"
b="$(BD_SHOW_CMD="$HERE/.multistub.sh" "$SKILL_DIR/pr-body.sh" pv-9cfj.3 pv-abcd)"
assert_eq "pr-body deterministic" "$a" "$b"

# Missing args -> exit 2.
set +e
"$SKILL_DIR/pr-body.sh" >/dev/null 2>&1
ec=$?
set -e
assert_exit "pr-body missing args exits 2" 2 "$ec"

# ============================================================
# git-safe-to-start.sh
# ============================================================
echo
echo "== git-safe-to-start.sh =="

TMPROOT="$(mktemp -d)"
trap 'rm -rf "$TMPROOT" "$HERE/.stub.sh" "$HERE/.multistub.sh"' EXIT

setup_repo() {
  local dir="$1"
  (
    cd "$dir"
    git init -q -b main
    git config user.email "test@example.com"
    git config user.name "Test"
    printf 'hello\n' > README.md
    git add README.md
    git commit -q -m "init"
  )
}

# Case 1: clean repo on main -> exit 0.
REPO1="$TMPROOT/clean-main"
mkdir -p "$REPO1"
setup_repo "$REPO1"
set +e
( cd "$REPO1" && "$SKILL_DIR/git-safe-to-start.sh" ) >/dev/null 2>&1
ec=$?
set -e
assert_exit "clean+main exits 0" 0 "$ec"

# Case 2: dirty tree on main -> exit 1.
REPO2="$TMPROOT/dirty-main"
mkdir -p "$REPO2"
setup_repo "$REPO2"
printf 'changed\n' >> "$REPO2/README.md"
set +e
( cd "$REPO2" && "$SKILL_DIR/git-safe-to-start.sh" ) >/dev/null 2>&1
ec=$?
set -e
assert_exit "dirty+main exits 1" 1 "$ec"

# Case 3: clean but wrong branch -> exit 1.
REPO3="$TMPROOT/clean-wrong-branch"
mkdir -p "$REPO3"
setup_repo "$REPO3"
( cd "$REPO3" && git checkout -q -b feature/foo )
set +e
( cd "$REPO3" && "$SKILL_DIR/git-safe-to-start.sh" ) >/dev/null 2>&1
ec=$?
set -e
assert_exit "clean+wrong-branch exits 1" 1 "$ec"

# Case 4: clean on a custom "main" branch via env override.
REPO4="$TMPROOT/custom-main"
mkdir -p "$REPO4"
setup_repo "$REPO4"
( cd "$REPO4" && git checkout -q -b trunk )
set +e
( cd "$REPO4" && GIT_SAFE_MAIN_BRANCH=trunk "$SKILL_DIR/git-safe-to-start.sh" ) >/dev/null 2>&1
ec=$?
set -e
assert_exit "clean+custom-main exits 0" 0 "$ec"

# Case 5: not in a git repo -> exit 2.
REPO5="$TMPROOT/not-a-repo"
mkdir -p "$REPO5"
set +e
( cd "$REPO5" && "$SKILL_DIR/git-safe-to-start.sh" ) >/dev/null 2>&1
ec=$?
set -e
assert_exit "non-repo exits 2" 2 "$ec"

# ============================================================
# Summary
# ============================================================
echo
echo "========================================="
printf 'Passed: %d  Failed: %d\n' "$PASS" "$FAIL"
if [ "$FAIL" -gt 0 ]; then
  echo "Failed tests:"
  for t in "${FAILED_TESTS[@]}"; do
    printf '  - %s\n' "$t"
  done
  exit 1
fi
exit 0
