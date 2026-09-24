# src/common/ui

Browser-side Vue components, composables, and styling that more than one frontend app consumes.

The module is named `ui`, not `public-ui`, because it serves every frontend app. Its consumers are the public site (`src/site`), the embeddable widget (`src/widget`), and the authenticated client (`src/client`). No shared component or composable here is restricted to a subset of them: a shared component styles itself with runtime custom properties that all three apps declare (see [Styling stance](#styling-stance)), so one compiled component renders in each app's own theme. The exception is `assets/mixins.scss`, the site and widget's legacy `$public-*` design system, which is housed here until it is retired and is not for the client or for shared components.

`components/EmptyState.vue` is the first styled shared component and the proof of that contract — the site's discovery page, the widget's list view, and the client's feed each mount it. It is landmark-free by default; a caller whose empty state stands in for a page region passes `region`, which renders a `<section>` labelled by the heading.

## Boundary rule

A module under `src/common/ui/` may import:

- anything under `@/common/*`
- the packages `vue`, `vue-router`, `luxon`, `i18next`, `i18next-vue` — and nothing else
- Sass builtins (`sass:color` and friends) in a `.scss` file or a `.vue` style block

Files under `src/common/ui/test/` may additionally import `vitest`, `@vue/test-utils`, and the node builtins `fs` and `path`. They get their own list rather than an exemption, so a test still cannot reach for an app store or an HTTP client to stand a fixture up.

`luxon` is imported by `calendar-views/calendar-grid.ts`, the week and month grid date math. `i18next-vue` is on the allowlist but unimported today, listed in advance of the `ui` i18n bundle that will need it, so arriving at that does not mean reopening this list.

The module may **never** import from `@/client`, `@/site`, `@/widget`, or `@/server` — by alias or by a relative path that escapes into them — and may never reach outside `src/` by a relative path at all. In the other direction, nothing under `src/server/` may import `src/common/ui`: this module assumes a browser.

`test/boundary.test.ts` enforces all of it: the two app-boundary directions, the package allowlist, and the relative-escape ban. It deliberately carries no "the client imports nothing from here" assertion: the client is a consumer like the other two apps. The allowlist is closed rather than a denylist because the likely breach of a shared presentational module is not `@/site/...` — a reviewer catches that by eye — but `pinia`, `axios`, or an app store reached through one of them. Shared components are presentational with data supplied by props precisely so that stays unnecessary.

Scope is this module only; the existing widget → site and site → client imports elsewhere in the tree are tracked debt on pv-z1in.

## Styling stance

**A shared component reads `--pav-*` custom properties, and only the names recorded in [TOKENS.md](TOKENS.md).** It never reads a `$public-*` SCSS variable and never includes a `public-*` mixin that does. A `$public-*` value is resolved at build time: a component compiled against `$public-text-primary-light` carries that value in its CSS and cannot take on another app's theme. A `--pav-*` property is resolved in the browser, against whichever app mounts the component.

The rule covers colours and shadows — what TOKENS.md holds. Spacing and type sizes have no shared runtime token yet (the client's `--pav-space-*` and `--pav-font-size-*` scales are not declared by the site or widget), so a shared component writes those as plain `rem` values.

A shared component writes no dark-mode rule. Each token already carries its light and dark value and switches under the app's theme selector, so `var(--pav-text-primary)` is correct in both themes as written. A shared component that needs `public-dark-mode`, `[data-theme="dark"]`, or `prefers-color-scheme` is reading the wrong value.

Each app supplies the tokens its own way:

- **Site and widget** — the `public-theme-tokens` mixin in `assets/mixins.scss`, included on `#app` in the site and on `.widget-root` in the widget. It emits each `$public-*` light/dark pair as one `--pav-*` property with the public palette's values.
- **Client** — its theme layer (`src/client/assets/style/themes/_light.scss`, `_dark.scss`, and `tokens/_shadows.scss`) declares every recorded name natively, most as the client's own tokens and the rest mapped onto existing client values.

TOKENS.md records which names each app declares and from what source. A name shared by all three apps does not mean a shared value: each app keeps its own palette behind the name.

`test/boundary.test.ts` fails if a `.vue` file under this module reads a `$public-*` variable or a `--pav-*` name TOKENS.md does not record. `test/public-theme-tokens.test.ts` fails if a recorded name is missing from the site/widget mixin or from the client theme layer. Adding a name to the shared set therefore means declaring it in both, then recording it.

`assets/mixins.scss` remains the site and widget's own design system — the `$public-*` variables and `public-*` mixins their app components still use while they migrate to `--pav-*`. It also carries a block of unprefixed aliases (`filter-container`, `input-base`, `dark-mode`, the `$spacing-*` scale, and others) kept for call sites that predate the `public-*` naming; those are compatibility surface, not the design system. None of it belongs in a shared component.

`assets/mixins.scss` is the canonical copy; `src/site/assets/mixins.scss` is a one-line `@forward` shim kept for the existing call sites. New call sites should `@use '@/common/ui/assets/mixins'` directly.

Breakpoints that a component must branch on in script live in `assets/breakpoints.ts`, mirroring the `public-tablet-up` and `public-desktop-up` mixins. Sass and TypeScript cannot share one declaration, so `test/breakpoints.test.ts` fails when the two drift apart.

## i18n

A shared component owns its translation keys, and those keys live in the `ui` namespace. Apps register the bundle; they do not define or override the keys a shared component reads. This is what keeps a component's copy the same wherever it is mounted, and keeps an app from having to know which keys its dependencies happen to need.

## Composable placement

`composables/` holds composables that are useful across features — `useLocale`, `useLocalizedContent`. A composable that only makes sense alongside one feature's state belongs in that feature's folder, next to the components it serves, not here.

## Tests

This module's tests live under `src/common/ui/test/`, mirroring the source layout, so the module is self-contained and moves in one piece. That diverges from the rest of `src/common/`, where an area's tests live under `src/common/test/<area>/`. Both globs are collected by `vitest.config.ts` (`src/**/*.test.ts`); the divergence is deliberate, not an oversight.
