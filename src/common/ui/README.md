# src/common/ui

Browser-side Vue components, composables, and styling that more than one frontend app consumes.

The module is named `ui`, not `public-ui`, because the intent is that it eventually serves every frontend app. Today its consumers are the public site (`src/site`) and the embeddable widget (`src/widget`); the authenticated client (`src/client`) is absent from that list because of an unfinished migration, not because of a principle or an open question.

## Which tenants the client may consume

The restriction is per tenant, not per module, and it is temporary.

**A tenant that styles itself with `$public-*` cannot be consumed by the client yet.** Not because the client is the wrong kind of app, but because `$public-*` values are SCSS variables resolved at build time: a component compiled against `$public-text-primary-light` carries that hex in its output and cannot take on a different app's theme. Site and widget share such a component only because both compile the same values. Declaring the missing names in the client would not help — SCSS variables are not read at runtime.

**A tenant that carries no styling has no such restriction, and the client may consume it today.** No token dependency means the styling migration decides nothing about it.

Of the source files here, exactly one is styled — `assets/mixins.scss`. The others — `assets/breakpoints.ts`, `calendar-views/calendar-grid.ts`, `composables/useLocale.ts`, `composables/useLocalizedContent.ts` — carry no styling at all and would work in the client unchanged. The split, not the module, is what the client rule follows.

The direction is settled: site and widget converge on the client's `--pav-*` custom-property system and its dual-selector dark mode, tracked on **pv-l3my**. Once that bead's token layer lands, a styled shared component reads `var(--pav-*)`, resolves against whichever app mounts it, and this section goes away. This is a sequencing constraint with a known end, not a standing rule.

This rule is stated, not enforced: it is a claim about what a component *renders like*, which an import scan is the wrong instrument for. `test/boundary.test.ts` deliberately carries no "the client imports nothing from here" assertion — such an assertion would be wrong for every unstyled file here today, and wrong for all of them once pv-l3my lands.

## Boundary rule

A module under `src/common/ui/` may import:

- anything under `@/common/*`
- the packages `vue`, `vue-router`, `luxon`, `i18next`, `i18next-vue` — and nothing else
- Sass builtins (`sass:color` and friends) in a `.scss` file or a `.vue` style block

Files under `src/common/ui/test/` may additionally import `vitest`, `@vue/test-utils`, and the node builtins `fs` and `path`. They get their own list rather than an exemption, so a test still cannot reach for an app store or an HTTP client to stand a fixture up.

`luxon` is imported by `calendar-views/calendar-grid.ts`, the week and month grid date math. `i18next-vue` is on the allowlist but unimported today, listed in advance of the `ui` i18n bundle that will need it, so arriving at that does not mean reopening this list.

The module may **never** import from `@/client`, `@/site`, `@/widget`, or `@/server` — by alias or by a relative path that escapes into them — and may never reach outside `src/` by a relative path at all. In the other direction, nothing under `src/server/` may import `src/common/ui`: this module assumes a browser.

`test/boundary.test.ts` enforces all of it: the two app-boundary directions, the package allowlist, and the relative-escape ban. The allowlist is closed rather than a denylist because the likely breach of a shared presentational module is not `@/site/...` — a reviewer catches that by eye — but `pinia`, `axios`, or an app store reached through one of them. Shared components are presentational with data supplied by props precisely so that stays unnecessary.

Scope is this module only; the existing widget → site and site → client imports elsewhere in the tree are tracked debt on pv-z1in.

## Styling stance

The target contract is the client's: a shared component reads `--pav-*` CSS custom properties that each app declares and themes, so one compiled component renders correctly wherever it is mounted. Reaching that is pv-l3my.

Until its token layer lands, shared components style themselves with the public design system: the `$public-*` SCSS tokens and `public-*` mixins in `assets/mixins.scss`, plus the four accent custom properties `public-theme-tokens` declares. Prefer `--pav-accent-*` over `$public-accent-*` wherever both exist — a widget's accent is configured at runtime, so the compile-time variable is already the wrong one to reach for (pv-nskn).

`public-theme-tokens` already declares the full runtime set on the site and widget roots: every `$public-*` light/dark pair as one `--pav-*` property, named after the client's token where the meaning matches. [TOKENS.md](TOKENS.md) maps each `$public-*` base to its token and records that the values are still the public palette.

`assets/mixins.scss` also carries a block of unprefixed aliases (`filter-container`, `input-base`, `dark-mode`, the `$spacing-*` scale, and others) kept for call sites that predate the `public-*` naming. Those are compatibility surface, not the design system — do not reach for them in a new shared component.

`assets/mixins.scss` is the canonical copy; `src/site/assets/mixins.scss` is a one-line `@forward` shim kept for the existing call sites. New call sites should `@use '@/common/ui/assets/mixins'` directly.

Breakpoints that a component must branch on in script live in `assets/breakpoints.ts`, mirroring the `public-tablet-up` and `public-desktop-up` mixins. Sass and TypeScript cannot share one declaration, so `test/breakpoints.test.ts` fails when the two drift apart.

## i18n

A shared component owns its translation keys, and those keys live in the `ui` namespace. Apps register the bundle; they do not define or override the keys a shared component reads. This is what keeps a component's copy the same wherever it is mounted, and keeps an app from having to know which keys its dependencies happen to need.

## Composable placement

`composables/` holds composables that are useful across features — `useLocale`, `useLocalizedContent`. A composable that only makes sense alongside one feature's state belongs in that feature's folder, next to the components it serves, not here.

## Tests

This module's tests live under `src/common/ui/test/`, mirroring the source layout, so the module is self-contained and moves in one piece. That diverges from the rest of `src/common/`, where an area's tests live under `src/common/test/<area>/`. Both globs are collected by `vitest.config.ts` (`src/**/*.test.ts`); the divergence is deliberate, not an oversight.
