# Public runtime tokens

The `--pav-*` custom properties the site and widget declare at runtime, and the `$public-*` pair each one carries. Look a name up here when moving a call site off `$public-*`; do not guess it.

`public-theme-tokens` in `assets/mixins.scss` is the one declaration site. It emits each token with its light value, and redeclares it with its dark value inside `public-dark-mode` — the same dual selector (`[data-theme="dark"]`, plus `prefers-color-scheme: dark` unless `data-theme="light"`) the client's theme layer uses. `test/public-theme-tokens.test.ts` fails if a `$public-<base>-light` / `-dark` pair has no token, or if a row below goes missing.

## Where the tokens live

The mixin is included on `#app` in the site (`src/site/assets/style.scss`) and on `.widget-root` in the widget (`src/widget/components/app.vue`) — not on `:root`. Anything rendered outside that element, such as content teleported to `<body>`, does not see them. Include it only on an element inside `<html>`, never on `:root` or `html`: the dark branch is an ancestor selector (`[data-theme="dark"] &`), so on the document root it matches nothing and the tokens silently stay light in both themes.

In the widget, `.widget-root` owns the token layer because it is also where `widgetStore.injectAccentColor` writes the owner's accent as inline `--pav-accent-light` / `--pav-accent-dark`. `--pav-accent` and `--pav-accent-hover` are declared as `var()` reads of those on the same element, so they resolve through the override. Declared on an ancestor instead, they would be computed there from the compiled default and inherited unchanged. `data-theme` sits on the iframe's `<html>`, an ancestor of `.widget-root`, which is what the dark selector expects.

## Naming rule

Where the client's theme layer (`src/client/assets/style/themes/_light.scss`, `_dark.scss`, and the shadow scale in `tokens/_shadows.scss`) has a token of the same meaning, the client's name wins. A public base with no client counterpart keeps its own name under the `--pav-` prefix.

| `$public-*` base | Token | Name source |
|---|---|---|
| `accent` | `--pav-accent` | public — reads `--pav-accent-light` / `--pav-accent-dark` |
| `accent-hover` | `--pav-accent-hover` | public — reads `--pav-accent-light-hover` / `--pav-accent-dark-hover` |
| `bg-primary` | `--pav-surface-primary` | client |
| `bg-secondary` | `--pav-surface-secondary` | client |
| `bg-tertiary` | `--pav-surface-tertiary` | client |
| `text-primary` | `--pav-text-primary` | client |
| `text-secondary` | `--pav-text-secondary` | client |
| `text-tertiary` | `--pav-text-muted` | client — the client's third text tier |
| `border-subtle` | `--pav-border-subtle` | client |
| `border-medium` | `--pav-border-medium` | public — the client's `border-primary`/`-secondary` do not rank the same way |
| `border-strong` | `--pav-border-strong` | public |
| `hover-overlay` | `--pav-interactive-hover` | client |
| `active-overlay` | `--pav-interactive-active` | client |
| `error` | `--pav-text-error` | client — for a border, mix it: `color-mix(in srgb, var(--pav-text-error) 30%, transparent)` |
| `error-bg` | `--pav-surface-error` | client |
| `success` | `--pav-success` | public — the client's `--pav-color-success` is a different, colour-blind-safe blue |
| `success-bg` | `--pav-success-bg` | public |
| `source-pill-bg` | `--pav-source-pill-bg` | public |
| `source-pill-color` | `--pav-source-pill-color` | public |
| `source-pill-hover-bg` | `--pav-source-pill-hover-bg` | public |
| `shadow-xs` | `--pav-shadow-xs` | client |
| `shadow-sm` | `--pav-shadow-sm` | client |
| `shadow-md` | `--pav-shadow-md` | client |
| `shadow-lg` | `--pav-shadow-lg` | client |
| `shadow-xl` | `--pav-shadow-xl` | client |

The four fixed-mode accent properties — `--pav-accent-light`, `--pav-accent-light-hover`, `--pav-accent-dark`, `--pav-accent-dark-hover` — keep their names. They are the widget's runtime override surface, and existing site and widget components read them directly. New call sites should read the theme-switched `--pav-accent` / `--pav-accent-hover` instead.

## Values are the public palette, not the client's

A shared name does not mean a shared value. Behind each token the site and widget keep their current `$public-*` value, so `--pav-surface-primary` is `#ffffff` / `#1a1a1e` here and a Stone surface in the client. Converging the public palette on the client's Stone values is deferred: it is a visual-design decision, and making it here would have changed how the site and widget render. Until it is made, a component that reads these tokens looks the way its app's palette dictates, which is the point of reading them.
