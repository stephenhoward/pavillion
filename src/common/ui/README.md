# src/common/ui

Browser-side Vue components, composables, and styling that more than one frontend app consumes.

Today that means the public site (`src/site`) and the embeddable widget (`src/widget`), which share the `$public-*` design system. The authenticated client (`src/client`) is not a consumer yet — not because it is excluded on principle, but because the two apps declare different design tokens. The client's styling is built on a broad set of `--pav-*` custom properties; the public stylesheet declares only four of them (`public-accent-tokens` emits `--pav-accent-light`, `--pav-accent-light-hover`, `--pav-accent-dark`, `--pav-accent-dark-hover` as a bridge for the widget's owner-configurable accent colour). Everything else the client's components read is undeclared here, so a component moved into this module would render unstyled in one app or the other. Reconciling those two token systems is the open question on **pv-z1in**; until it is answered, a component that both the client and a public app need has no home here.

## Boundary rule

A module under `src/common/ui/` may import:

- anything under `@/common/*`
- `vue`, `vue-router`
- `luxon`, `i18next`, `i18next-vue`

It may **never** import from `@/client`, `@/site`, `@/widget`, or `@/server` — by alias or by a relative path that escapes into them. In the other direction, nothing under `src/server/` may import `src/common/ui`: this module assumes a browser.

`test/boundary.test.ts` enforces both directions. It governs this module only; the existing widget → site and site → client imports elsewhere in the tree are tracked debt on pv-z1in.

## Styling stance

Shared components style themselves with the public design system only: the `$public-*` SCSS tokens and `public-*` mixins in `assets/mixins.scss`. No app-local token, and no `--pav-*` custom property beyond the four accent variables `public-accent-tokens` declares above.

`assets/mixins.scss` also carries a block of unprefixed aliases (`filter-container`, `input-base`, `dark-mode`, the `$spacing-*` scale, and others) kept for call sites that predate the `public-*` naming. Those are compatibility surface, not the design system — do not reach for them in a new shared component.

`assets/mixins.scss` is the canonical copy; `src/site/assets/mixins.scss` is a one-line `@forward` shim kept for the existing call sites. New call sites should `@use '@/common/ui/assets/mixins'` directly.

Breakpoints that a component must branch on in script live in `assets/breakpoints.ts`, mirroring the `public-tablet-up` and `public-desktop-up` mixins. Sass and TypeScript cannot share one declaration, so `test/breakpoints.test.ts` fails when the two drift apart.

## i18n

A shared component owns its translation keys, and those keys live in the `ui` namespace. Apps register the bundle; they do not define or override the keys a shared component reads. This is what keeps a component's copy the same wherever it is mounted, and keeps an app from having to know which keys its dependencies happen to need.

## Composable placement

`composables/` holds composables that are useful across features — `useLocale`, `useLocalizedContent`. A composable that only makes sense alongside one feature's state belongs in that feature's folder, next to the components it serves, not here.

## Tests

This module's tests live under `src/common/ui/test/`, mirroring the source layout, so the module is self-contained and moves in one piece. That diverges from the rest of `src/common/`, where an area's tests live under `src/common/test/<area>/`. Both globs are collected by `vitest.config.ts` (`src/**/*.test.ts`); the divergence is deliberate, not an oversight.
