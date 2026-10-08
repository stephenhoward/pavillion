# Runtime theme tokens

The `--pav-*` custom properties the frontend apps declare at runtime, in two tiers:

- **Shared tokens** are declared by every app — the site and widget through `public-theme-tokens`, the client through its own theme layer. They are the only names a shared component under `src/common/ui` may read (`test/boundary.test.ts` enforces that).
- **Public-only tokens** are declared by `public-theme-tokens` alone, for the site's and widget's own components. A shared component may not read them: the client does not declare them, so the component would render unstyled there.

Look a name up here when moving a call site off `$public-*` or off a literal dark block, and do not guess it. A value that varies by theme or by host is a runtime token; a value that does not stays a compile-time `$public-*` constant in `assets/mixins.scss`.

## Site and widget

`public-theme-tokens` in `assets/mixins.scss` is the one site/widget declaration site. Its base block declares every token with its light value, plus `color-scheme: light`. The private `_public-theme-dark-values` mixin beside it declares every dark value, plus `color-scheme: dark`, with no selector of its own; `public-theme-tokens` includes it under both dark branches — `[data-theme="dark"]`, and `prefers-color-scheme: dark` unless `data-theme="light"` — the same dual selector the client's theme layer uses. Each dark value is therefore written once. `test/public-theme-tokens.test.ts` fails if a row of either table below is missing from the base block or the helper, if the base block declares a name neither table records (the four fixed accent properties apart), if a dark value is written anywhere but the helper or either dark branch stops including it, or if site, widget or shared style reads a `var(--pav-*)` the base block does not declare.

### Where the tokens live

The mixin is included in exactly two places, each time as the last declaration in its block: on `#app` in the site (`src/site/assets/style.scss`) and on `.widget-root` in the widget (`src/widget/components/app.vue`). It ends in nested rules, and a declaration after a nested rule makes Sass split the block. Anything rendered outside that element, such as content teleported to `<body>`, does not see the tokens; no Teleport exists in the site, the widget or `src/common/ui` today.

Never include it on `:root`, `html` or `body`: the dark branch is an ancestor selector (`[data-theme="dark"] &`), so on the document root it matches nothing and the tokens silently stay light in both themes. Never re-include it on a descendant of `.widget-root` either: it would redeclare `--pav-accent` there from the compiled default and shadow the owner's accent.

In the widget, `.widget-root` owns the token layer because it is also where `widgetStore.injectAccentColor` writes the owner's accent as inline `--pav-accent-light` / `--pav-accent-dark`, with `--pav-accent-light-hover` / `--pav-accent-dark-hover` derived from it (10% towards black and white respectively). `--pav-accent` and `--pav-accent-hover` are declared as `var()` reads of those on the same element — the light pair in the base block, the dark pair in the helper — so they resolve through the override. Declared on an ancestor instead, they would be computed there from the compiled default and inherited unchanged. `data-theme` sits on the iframe's `<html>`, an ancestor of `.widget-root`, which is what the dark selector expects.

### color-scheme

`color-scheme` is emitted by the token layer, beside the tokens, so native controls inside `#app` and `.widget-root` — date inputs, selects, autofill, the scrollbars of scrolling elements — switch under the same selector that switches the colours around them. It lands on the include element, not the document root, so the viewport scrollbar and the page canvas follow `:root` and stay light; that is not a regression. The token layer is the only place in the site, the widget and `src/common/ui` that may set it.

### Naming rule

Apply these in order when a theme-varying value needs a token:

1. **The client's meaning wins.** If the client's theme layer (`src/client/assets/style/themes/_light.scss`, `_dark.scss`, and the shadow scale in `tokens/_shadows.scss`) has a token of the same meaning, use its name even when the values differ. The token is shared, because the client already declares it. The comparison is against the theme tier only — the semantic tokens those files declare — not the `--pav-color-*` palette primitives beneath them, which is why `--pav-accent` and `--pav-success` keep public names even though the client mappings below put them on palette values.
2. **Reuse an existing public token only for the same role and the same value.** A value that matches an existing token but plays a different role gets its own token: a coincidence of value is not a mapping.
3. **Otherwise mint a public-only token.**
   - Use the type-first grammar `--pav-<surface|text|border|shadow|interactive>-<role>[-state]`, such as `--pav-surface-popover` or `--pav-border-picker-hover`.
   - Badge and pill groups may be named after their component, as `--pav-source-pill-*` is, with the client's `-bg` / `-text` suffixes. The legacy `--pav-source-pill-color` keeps its name.
   - Field colours use the type-first grammar with a `field` role (`--pav-surface-field`). Never use `--pav-control-*`: the client's `--pav-control-box-size` already occupies that family.
   - A non-colour token names what it holds, such as `--pav-vignette-gain`.
   - Never name a token by its alpha.
4. **No collisions.** A public-only name may not equal any name the client declares anywhere, in its theme tier or under `tokens/`.
5. **Promotion.** A public-only token becomes shared by declaring it in the client's theme layer and moving its row to the shared table. Until then, a shared component never reads it.

The four fixed-mode accent properties — `--pav-accent-light`, `--pav-accent-light-hover`, `--pav-accent-dark`, `--pav-accent-dark-hover` — are in neither tier. They are the widget's runtime override surface and keep their names; existing site and widget components read them directly. New call sites should read the theme-switched `--pav-accent` / `--pav-accent-hover` instead.

## Shared tokens

| Token | Name source |
|---|---|
| `--pav-accent` | public — reads `--pav-accent-light` / `--pav-accent-dark` |
| `--pav-accent-hover` | public — reads `--pav-accent-light-hover` / `--pav-accent-dark-hover` |
| `--pav-surface-primary` | client |
| `--pav-surface-secondary` | client |
| `--pav-surface-tertiary` | client |
| `--pav-text-primary` | client |
| `--pav-text-secondary` | client |
| `--pav-text-muted` | client — the client's third text tier |
| `--pav-border-subtle` | client |
| `--pav-border-medium` | public — the client's `border-primary`/`-secondary` do not rank the same way |
| `--pav-border-strong` | public |
| `--pav-border-error` | client — an invalid form field's border and outline |
| `--pav-interactive-hover` | client |
| `--pav-interactive-active` | client |
| `--pav-text-error` | client — error text |
| `--pav-surface-error` | client |
| `--pav-success` | public — the client's `--pav-color-success` is a different, colour-blind-safe blue |
| `--pav-success-bg` | public |
| `--pav-source-pill-bg` | public |
| `--pav-source-pill-color` | public |
| `--pav-source-pill-hover-bg` | public |
| `--pav-badge-sky-bg` | client — the sky-tinted pill badge fill (the category badge) |
| `--pav-badge-sky-text` | client — that badge's text |
| `--pav-shadow-xs` | client |
| `--pav-shadow-sm` | client |
| `--pav-shadow-md` | client |
| `--pav-shadow-lg` | client — also the popover shadow |
| `--pav-shadow-xl` | client |

### Values are the public palette, not the client's

A shared name does not mean a shared value. Behind each shared token the site and widget keep their own palette, so `--pav-surface-primary` is `#ffffff` / `#1a1a1e` here and a Stone surface in the client. Converging the public palette on the client's Stone values is deferred (pv-olnr): it is a visual-design decision, and making it here would change how the site and widget render. Until it is made, a component that reads these tokens looks the way its app's palette dictates, which is the point of reading them.

## Public-only tokens

Declared by `public-theme-tokens` only, and read only by site and widget components. Every name here is absent from the client's style tree. Each row says where the name comes from and why it is a token of its own rather than a reuse of an existing one.

| Token | Name source | Reason |
|---|---|---|
| `--pav-surface-popover` | public — the client has no popover surface | the opaque fill behind the date-filter dropdown and the language-switcher menu |
| `--pav-popover-backdrop-filter` | public — names what it holds | non-colour: `none` in light, a blur in dark, behind the same two popovers |
| `--pav-surface-field` | public — the "field" role | a form field sits on the page surface in light and one tier up in dark; declared as `var()` of the surface tiers so that relation survives palette work |
| `--pav-surface-field-hover` | public — field role | the hovered field fill, the same one-tier-up asymmetry |
| `--pav-surface-field-focus` | public — field role | the focused field fill |
| `--pav-surface-picker` | public — the "picker" role (the date filter's trigger and inputs) | the trigger's resting fill, a step above a field in dark |
| `--pav-border-picker` | public — picker role | the picker controls' border; input-base's border tokens carry different values |
| `--pav-border-picker-hover` | public — picker role | that border on hover |
| `--pav-border-picker-divider` | public — picker role | the popover's section divider; fainter than `--pav-border-subtle` in dark |
| `--pav-text-picker` | public — picker role | the picker controls' text |
| `--pav-text-picker-subtle` | public — picker role | subdued picker labels and the clear button's resting ink |
| `--pav-text-picker-hint` | public — picker role | the date-format hint; fainter than `--pav-text-muted` in dark |
| `--pav-surface-picker-clear-hover` | public — picker role | the clear button's hover fill; equal to `--pav-border-medium` by value but a fill, not a border |
| `--pav-text-picker-clear-hover` | public — picker role | the clear button's hover ink |
| `--pav-shadow-picker` | public — picker role | the trigger's resting elevation; matches no step of the shadow scale |
| `--pav-shadow-picker-hover` | public — picker role | the trigger's hover elevation; matches no scale step |
| `--pav-shadow-picker-focus` | public — picker role | a decorative halo beside the accent focus outline, not a focus indicator, so not the client's `--pav-shadow-focus` |
| `--pav-shadow-selected` | public — the "selected" state of an accent control | the elevation of a selected accent control (an active date filter or date pill) |
| `--pav-filter-pill-hover-bg` | public — the filter-pill group, after `--pav-source-pill-*` | the hovered filter pill's fill, also the clear button's resting fill |
| `--pav-filter-pill-hover-text` | public — filter-pill group | the hovered filter pill's ink |
| `--pav-border-filter-pill-focus` | public — filter-pill group | the filter pills' focus outline; `--pav-border-strong` is too faint for it |
| `--pav-surface-scroll-arrow-hover` | public — the category scroller's arrow role | the category scroller's arrow on hover; `--pav-interactive-hover` equals that arrow's resting fill |
| `--pav-recurrence-badge-bg` | public — the badge group | a translucent scrim over event media, not a status tint, so not a client `--pav-badge-*` fill |
| `--pav-vignette-gain` | public — names what it holds | non-colour: the multiplier on the event-image vignette's alpha, `1` in light and `2.5` in dark (see below) |
| `--pav-loading-pulse-gradient` | public — names what it holds | the image-loading placeholder, recorded as a whole value the way shadows are |

### --pav-vignette-gain

The event-image vignette darkens more in dark mode, and every dark alpha is exactly 2.5 times its light one. Rather than three colour tokens per vignette step, the token layer declares the multiplier — `1` in light, `2.5` in dark — and each component writes `rgba(0, 0, 0, calc(<base alpha> * var(--pav-vignette-gain)))`, keeping its own base alphas and gradient geometry. It is a theme-varying non-colour value, which is why it is a runtime token at all.

## Client mappings

The client does not use the mixin. Its theme layer declares every shared token: `themes/_light.scss` in `:root`, `themes/_dark.scss` under the same dual selector, and the shadow scale in `tokens/_shadows.scss`. `test/public-theme-tokens.test.ts` checks that it declares every row of the shared table, and that no public-only name is declared anywhere in the client's style tree.

A shared token whose name source is **client** is the client's own theme token. The client's components do not use the shared tokens with a **public** name source, so the theme layer declares them only for shared components, each mapped onto an existing client value. None of these mappings changes a value the client already declared.

| Token | Light | Dark | Why |
|---|---|---|---|
| `--pav-accent` | `--pav-color-interactive-primary` | same | the client's primary action colour; brand orange in both themes |
| `--pav-accent-hover` | `--pav-color-interactive-primary-hover` | same | its hover shade |
| `--pav-border-medium` | `--pav-color-stone-300` | `--pav-color-stone-600` | the client's `--pav-border-primary` step |
| `--pav-border-strong` | `--pav-color-stone-400` | `--pav-color-stone-500` | one stone step stronger |
| `--pav-success` | `--pav-color-success` | same (switches itself) | the client's colour-blind-safe blue, not the public green |
| `--pav-success-bg` | `--pav-color-alert-success-bg` | same (switches itself) | the fill paired with that blue |
| `--pav-source-pill-bg` | `--pav-color-sky-50` | sky at 15% | the client's sky badge fill |
| `--pav-source-pill-color` | `--pav-color-sky-700` | `--pav-color-sky-300` | the sky badge text |
| `--pav-source-pill-hover-bg` | `--pav-color-sky-100` | sky at 25% | one step deeper than the fill |

As on the public side, a shared name carries the app's own palette: `--pav-success` is green in the site and widget and blue in the client, because each app's success colour is what a shared component there should show.
