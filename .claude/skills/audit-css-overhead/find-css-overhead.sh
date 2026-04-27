#!/usr/bin/env bash
# find-css-overhead.sh
#
# Pre-filter for the audit-css-overhead skill. Walks the requested scope and
# emits candidate sites for each of the four CSS pattern smells. Read-only,
# always exits 0. Companion to .claude/skills/audit-css-overhead/SKILL.md.
#
# Usage:
#   .claude/skills/audit-css-overhead/find-css-overhead.sh [path...]
#
# Defaults to src/client and src/site if no paths are given.
#
# Implementation notes: this script uses grep -E and perl rather than rg or
# pcre2grep so it runs on a stock macOS / Linux without extra installs.

set -uo pipefail

# Resolve scope. Defaults match the two Vue apps with scoped stylesheets.
ROOTS=("$@")
if [[ ${#ROOTS[@]} -eq 0 ]]; then
  ROOTS=("src/client" "src/site")
fi

# Validate that every requested root exists; warn but continue on missing.
VALID_ROOTS=()
for r in "${ROOTS[@]}"; do
  if [[ -e "$r" ]]; then
    VALID_ROOTS+=("$r")
  else
    echo "warning: scope path not found, skipping: $r" >&2
  fi
done
if [[ ${#VALID_ROOTS[@]} -eq 0 ]]; then
  echo "error: no valid scope paths" >&2
  exit 2
fi

# Files that ARE the canonical pattern libraries — exclude their own contents
# from match output, otherwise we'd flag every canonical mixin as "duplication
# of itself."
is_canonical_path() {
  case "$1" in
    */assets/style/mixins/_stacks.scss) return 0 ;;
    */assets/style/components/_stacks.scss) return 0 ;;
    */assets/style/components/_forms.scss) return 0 ;;
    */assets/style/components/_calendar-admin.scss) return 0 ;;
    */assets/style/mixins/_typography.scss) return 0 ;;
    */assets/style/mixins/_spacing.scss) return 0 ;;
    */assets/style/mixins/_logical-properties.scss) return 0 ;;
    */assets/style/mixins/_layout.scss) return 0 ;;
    */assets/style/mixins/_visibility.scss) return 0 ;;
    */assets/style/mixins/_breakpoints.scss) return 0 ;;
    */assets/style/mixins/breakpoints.scss) return 0 ;;
    */assets/style/mixins/index.scss) return 0 ;;
    */assets/style/tokens/*) return 0 ;;
  esac
  return 1
}

# Collect candidate files: every .scss/.vue/.css under scope, minus canonical.
gather_files() {
  local f
  for r in "${VALID_ROOTS[@]}"; do
    while IFS= read -r f; do
      if ! is_canonical_path "$f"; then
        printf '%s\n' "$f"
      fi
    done < <(find "$r" -type f \( -name '*.scss' -o -name '*.vue' -o -name '*.css' \) 2>/dev/null)
  done
}

# Populate FILES portably (macOS ships bash 3.2 without `mapfile`).
FILES=()
while IFS= read -r _line; do
  [[ -n "$_line" ]] && FILES+=("$_line")
done < <(gather_files)

section() {
  printf '\n=== %s ===\n' "$1"
}

note() {
  printf '   %s\n' "$1"
}

print_count() {
  local label=$1 count=$2
  printf '   (%d %s)\n' "$count" "$label"
}

# Run a perl multiline regex over every file in $FILES. Emits
# `path:lineno:matched-fragment` for each hit. One perl process for the
# whole batch — much faster than per-file invocation on broad scopes.
perl_multiline() {
  local pattern=$1
  if [[ ${#FILES[@]} -eq 0 ]]; then
    return 0
  fi
  perl -e '
    use strict; use warnings;
    my $pat = shift @ARGV;
    for my $f (@ARGV) {
      open(my $fh, "<", $f) or next;
      local $/; my $src = <$fh>;
      close $fh;
      while ($src =~ /$pat/gms) {
        my $offset = $-[0];
        my $line = (substr($src, 0, $offset) =~ tr/\n//) + 1;
        my $matched = $&;
        $matched =~ s/\s+/ /g;
        if (length($matched) > 120) { $matched = substr($matched, 0, 117) . "..."; }
        print "$f:$line:$matched\n";
      }
    }
  ' "$pattern" "${FILES[@]}" 2>/dev/null || true
}

# Single-line grep across candidate files. Same path:line:fragment shape.
grep_files() {
  local pattern=$1
  if [[ ${#FILES[@]} -eq 0 ]]; then
    return 0
  fi
  grep -EnH "$pattern" "${FILES[@]}" 2>/dev/null || true
}

printf 'audit-css-overhead candidate finder\n'
printf 'scope: %s\n' "${VALID_ROOTS[*]}"
printf 'files scanned: %d\n' "${#FILES[@]}"
printf 'date: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')"

# --------------------------------------------------------------------------
# Smell 1 — BEM-element rules that are one-line @include shells
# --------------------------------------------------------------------------
section "Smell 1 — BEM-element rules that are pure mixin shells"
note "Pattern: &__foo { @include bar; } with no other rules"
note "Sites where every BEM element forwards to a mixin are smell-1 ceremony."
echo
# Single-line form: `  &__name { @include something; }`
grep_files '&__[a-zA-Z][a-zA-Z0-9_-]*[[:space:]]*\{[[:space:]]*@include[[:space:]]+[a-zA-Z][a-zA-Z0-9_-]*[[:space:]]*;[[:space:]]*\}'
# Multi-line form: `  &__name {\n    @include something;\n  }` with no other rules
perl_multiline '&__[a-zA-Z][a-zA-Z0-9_-]*\s*\{\s*@include\s+[a-zA-Z][a-zA-Z0-9_-]*\s*;\s*\}'

# --------------------------------------------------------------------------
# Smell 2 — Domain-named mixin/component-style files
# --------------------------------------------------------------------------
section "Smell 2 — Mixin/component-style files outside the canonical library"
note "Read each: are the contents generic primitives wearing a domain name?"
note "Compare each file's mixins against vstack/hstack/form-field/modal-actions/code-display."
echo
for r in "${VALID_ROOTS[@]}"; do
  while IFS= read -r f; do
    if ! is_canonical_path "$f"; then
      printf '%s\n' "$f"
    fi
  done < <(find "$r" -type f \( -path '*/style/mixins/_*.scss' -o -path '*/style/components/_*.scss' \) 2>/dev/null | sort)
done

# --------------------------------------------------------------------------
# Smell 4a — Inline vstack candidates
# --------------------------------------------------------------------------
section "Smell 4a — Inline vstack candidates (flex column with token gap)"
note "Replace with: .vstack utility class on the element, OR @include vstack"
echo
perl_multiline 'display:\s*flex\s*;[^}]{0,140}flex-direction:\s*column\s*;[^}]{0,140}gap:\s*var\(--pav-space-' "${FILES[@]}"
# Reverse order (gap before direction is rare but possible)
perl_multiline 'display:\s*flex\s*;[^}]{0,140}gap:\s*var\(--pav-space-[^}]{0,140}flex-direction:\s*column' "${FILES[@]}"

# --------------------------------------------------------------------------
# Smell 4b — Inline modal-actions candidates
# --------------------------------------------------------------------------
section "Smell 4b — Inline modal-actions candidates (top border + end justify)"
note "Replace with: @include modal-actions (from _calendar-admin.scss)"
echo
perl_multiline '(border-top|border-block-start)\s*:[^;]+;[^}]{0,200}justify-content:\s*(flex-)?end' "${FILES[@]}"
perl_multiline 'justify-content:\s*(flex-)?end\s*;[^}]{0,200}(border-top|border-block-start)\s*:' "${FILES[@]}"

# --------------------------------------------------------------------------
# Smell 4c — Hand-rolled mono surfaces
# --------------------------------------------------------------------------
section "Smell 4c — Hand-rolled mono font-family surfaces"
note "Replace with: @include code-display (block) or @include code-input (inline)"
note "Canonical token: var(--pav-font-family-mono)"
echo
grep_files "font-family:[[:space:]]*['\"]?(Monaco|Menlo|Consolas|Courier|Ubuntu Mono)"
grep_files 'font-family:[[:space:]]*[^;]*\bmonospace\b'

# --------------------------------------------------------------------------
# Smell 4d — Stone-scale tokens used in component code
# --------------------------------------------------------------------------
section "Smell 4d — Raw stone-scale tokens in component code"
note "Replace with: semantic tokens (--pav-text-secondary, --pav-surface-card,"
note "--pav-border-subtle, etc.). Token map lives in tokens/_colors.scss."
echo
grep_files 'var\(--pav-color-stone-[0-9]+\)'

# --------------------------------------------------------------------------
# Smell 3 — Form-field / form-group naming inconsistency
# --------------------------------------------------------------------------
section "Smell 3 — Form-field naming inconsistency"
note "Both .form-field/.field-label and .form-group/.form-label appear in the"
note "codebase. Pick one, migrate the other. See pv-qda2."
echo
grep_files '\.(form-field|field-label|form-group|form-label)\b'

echo
echo '--- end of candidate findings ---'
echo 'next: paste this output into the agent prompt in SKILL.md (Step 2).'
