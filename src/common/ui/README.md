# src/common/ui

Browser-side Vue components, composables, and styling that more than one frontend app consumes.

The module is named `ui`, not `public-ui`, because it serves every frontend app. Its consumers are the public site (`src/site`), the embeddable widget (`src/widget`), and the authenticated client (`src/client`). No shared component or composable here is restricted to a subset of them: a shared component styles itself with runtime custom properties that all three apps declare (see [Styling stance](#styling-stance)), so one compiled component renders in each app's own theme. The exception is `assets/mixins.scss`, the site and widget's own design system, which lives here but is not for the client or for shared components (see [Styling stance](#styling-stance)).

`components/EmptyState.vue` is the first styled shared component and the proof of that contract — the site's discovery page, the widget's list view, and the client's feed each mount it. It is landmark-free by default; a caller whose empty state stands in for a page region passes `region`, which renders a `<section>` labelled by the heading.

## Boundary rule

A module under `src/common/ui/` may import:

- anything under `@/common/*`
- the packages `vue`, `vue-router`, `luxon`, `i18next`, `i18next-vue` — and nothing else
- Sass builtins (`sass:color` and friends) in a `.scss` file or a `.vue` style block

Files under `src/common/ui/test/` may additionally import `vitest`, `@vue/test-utils`, and the node builtins `fs` and `path`. They get their own list rather than an exemption, so a test still cannot reach for an app store or an HTTP client to stand a fixture up.

`luxon` is the date math of the calendar grids and the view state. `i18next-vue` is read by the shared components that render `ui` keys.

The module may **never** import from `@/client`, `@/site`, `@/widget`, or `@/server` — by alias or by a relative path that escapes into them — and may never reach outside `src/` by a relative path at all. In the other direction, nothing under `src/server/` may import `src/common/ui`: this module assumes a browser.

`test/boundary.test.ts` enforces all of it: the two app-boundary directions, the package allowlist, and the relative-escape ban. It deliberately carries no "the client imports nothing from here" assertion: the client is a consumer like the other two apps. The allowlist is closed rather than a denylist because the likely breach of a shared presentational module is not `@/site/...` — a reviewer catches that by eye — but `pinia`, `axios`, or an app store reached through one of them. Shared components are presentational with data supplied by props precisely so that stays unnecessary. The sanctioned exception is a composable that must drive an app store: it accepts the store through a structurally typed interface instead of importing it, as `useCalendarWindowSync` and `useCalendarViewContainer` do, so the app passes its store in and the module never names it.

Scope is this module only; the existing widget → site and site → client imports elsewhere in the tree are tracked debt on pv-ese5. The decision behind this module, including that boundary, is [DEC-019](../../../agent-os/product/decisions/dec-019-shared-ui-module.md).

## Styling stance

**A shared component reads `--pav-*` custom properties, and only the names in the shared tier of [TOKENS.md](TOKENS.md).** It never reads a `$public-*` SCSS variable and never includes a `public-*` mixin that does. A `$public-*` value is resolved at build time: a component compiled against one carries that value in its CSS and cannot take on another app's value. A `--pav-*` property is resolved in the browser, against whichever app mounts the component.

**A value that varies by theme or by host is a runtime token; a value that does not is a compile-time constant.** Colour, shadow, `color-scheme` and the few non-colour values that change in dark mode are `--pav-*` tokens. Spacing, type, radius, motion and breakpoints change with neither, so they have no runtime token: the site and widget keep them as `$public-*` Sass constants, and a shared component, which may not read `$public-*`, writes them as plain `rem` values. The reason is not theme: these scales differ by app. The client's scale is not the public one (`font-size-sm` is 16px there and 13px here) and a shared component renders in the client too, so it uses plain `rem` until a shared scale exists (pv-olnr), while site and widget app components keep the named `$public-*` scale. (The client's `--pav-space-*` and `--pav-font-size-*` scales use those names with different values, which is one reason the public side does not declare them.) An owner-configurable non-colour value, such as a per-calendar font, would be a host-varying value and would have to become a token. The decision and what reopens it are rule 10 of DEC-019.

A shared component writes no dark-mode rule. Each token already carries its light and dark value and switches under the app's theme selector, so `var(--pav-text-primary)` is correct in both themes as written. A shared component that needs `[data-theme="dark"]` or `prefers-color-scheme` is reading the wrong value.

A shared component puts no text and no focus indicator on or in `--pav-accent`. The accent is decoration (rules, rings, borders) and never the only carrier of a state, because the widget's accent is owner-configurable and TOKENS.md has no ink paired with it. The tests below check token names, not pairings, so this one is held by review. When pv-8l49 adds an on-accent text pair, the rule relaxes to "text on the accent reads that pair".

Each app supplies the tokens its own way:

- **Site and widget** — the `public-theme-tokens` mixin in `assets/mixins.scss`, included on `#app` in the site and on `.widget-root` in the widget. It declares every name in both tiers with the public palette's light and dark values, and the `color-scheme` that goes with them.
- **Client** — its theme layer (`src/client/assets/style/themes/_light.scss`, `_dark.scss`, and `tokens/_shadows.scss`) declares every shared name natively, most as the client's own tokens and the rest mapped onto existing client values. It declares no public-only name.

TOKENS.md records each name's tier and source: **shared** names are declared by every app, **public-only** names by the site and widget alone, for their own components. A name shared by all three apps does not mean a shared value: each app keeps its own palette behind the name.

`test/boundary.test.ts` fails if a `.vue` file under this module reads a `$public-*` variable or a `--pav-*` name outside TOKENS.md's shared tier, includes a `public-*` mixin other than the layout-only ones it allowlists (the breakpoint mixins, `public-sr-only`, `public-horizontal-scroll`, and the `public-scroll-fade-*` masks), or mentions `data-theme` or `prefers-color-scheme` in a style block. `test/public-theme-tokens.test.ts` fails if a recorded name is missing from the site/widget mixin, if a shared name is missing from the client theme layer, if the client declares a public-only name, or if site, widget or shared style reads a `var(--pav-*)` the mixin does not declare. Adding a shared name therefore means declaring it in both apps, then recording it; promoting a public-only name means declaring it in the client and moving its row.

`scripts/check-theme-tokens.ts` (`npm run lint:theme`, part of `npm run lint`) holds the site, widget and this module to the token layer: no colour `$public-*` (only the non-colour families it allowlists), no `[data-theme]`, `prefers-color-scheme`, `color-scheme` or `light-dark(` outside `public-theme-tokens` and its `_public-theme-dark-values` helper, and no include of `public-theme-tokens` except on `#app` in the site and `.widget-root` in the widget. It has no suppression comment. It does not report a colour literal written straight into a component, which renders the same in both themes; a warn-only rule for those is pv-4wwt.

`assets/mixins.scss` is the site and widget's own design system, and its permanent home: the non-colour `$public-*` constants, the `public-*` component mixins, and the token layer (`public-theme-tokens`). Every `public-*` mixin takes its colour from `--pav-*` tokens, apart from the white-on-accent ink DEC-019 rule 5 records as a residual, so, like any `--pav-*` reader, it renders correctly only under an element that declares them (`#app` in the site, `.widget-root` in the widget), per TOKENS.md. The file also carries a block of unprefixed aliases (`filter-*`, `search-*`, `input-base`, `mobile-only`, `medium-size-device`, the `$spacing-*` scale, `$font-regular` / `$font-medium`) kept for call sites that predate the `public-*` naming; those are compatibility surface, not the design system, and their retirement is pv-msw8. None of the file belongs in a shared component beyond the layout-only mixins listed above.

Site and widget style loads it as `@use '@/common/ui/assets/mixins'`.

Breakpoints that a component must branch on in script live in `assets/breakpoints.ts`, mirroring the `public-tablet-up` and `public-desktop-up` mixins. Sass and TypeScript cannot share one declaration, so `test/breakpoints.test.ts` fails when the two drift apart.

The Creato Display typeface lives in `assets/fonts/`, and `assets/fonts.scss` declares its `@font-face` rules. All three apps load it from their global stylesheets (the client through `src/client/assets/style/base/_fonts.scss`), so the faces are declared once. The widget needs it as much as the others: it renders in an iframe, which inherits no fonts from the embedding page.

## i18n

A shared component owns its translation keys, and those keys live in the `ui` namespace. Apps register the bundle; they do not define or override the keys a shared component reads. This is what keeps a component's copy the same wherever it is mounted, and keeps an app from having to know which keys its dependencies happen to need.

The bundles live in `calendar-views/locales/{lang}/ui.json`, and `locales.ts` exports them as `uiResources`. The site, widget, and client each spread `uiResources.<lang>` into their static i18next `resources` beside their own namespaces; none calls `addResourceBundle`. `test/locales.test.ts` fails if a language in `AVAILABLE_LANGUAGES` lacks a bundle or its keys differ from English, and each app's `test/service/locale.test.ts` fails if the app stops registering `ui` for one.

This is the home for any string a shared component renders, whichever app mounts it. The widget's `system` namespace, which it imports from `src/site/locales/`, is app-level copy and outside this rule: it is part of the widget → site debt noted under [Boundary rule](#boundary-rule). When a string moves out of an app view into a shared component, its key moves into `ui` rather than staying in the app's `system`.

## Composable placement

`composables/` holds composables that are useful across features — `useLocale`, `useLocalizedContent`, `useContainerWidth`. A composable that only makes sense alongside one feature's state belongs in that feature's folder, next to the components it serves, not here.

## Tests

This module's tests live under `src/common/ui/test/`, mirroring the source layout, so the module is self-contained and moves in one piece. That diverges from the rest of `src/common/`, where an area's tests live under `src/common/test/<area>/`. Both globs are collected by `vitest.config.ts` (`src/**/*.test.ts`); the divergence is deliberate, not an oversight.
