# Design Token Usage

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for design token usage in Pavillion stylesheets.

## Established Convention

In the client (`src/client`), all visual values (colors, spacing, typography, borders, shadows) must use CSS custom properties from the `--pav-*` token system. Tokens are globally available -- no imports needed. The site and widget follow a narrower rule; see [Site and widget](#site-and-widget). The categories and examples below are the client's.

### Token Categories

| Category | Prefix | Example |
|----------|--------|---------|
| Colors | `--pav-color-*` | `--pav-color-brand-primary`, `--pav-color-error` |
| Surfaces | `--pav-surface-*` | `--pav-surface-primary`, `--pav-surface-card` |
| Text | `--pav-text-*` | `--pav-text-primary`, `--pav-text-secondary` |
| Spacing | `--pav-space-*` | `--pav-space-4`, `--pav-space-8` |
| Typography | `--pav-font-size-*`, `--pav-font-weight-*` | `--pav-font-size-lg`, `--pav-font-weight-bold` |
| Borders | `--pav-border-radius-*`, `--pav-border-width-*` | `--pav-border-radius-md`, `--pav-border-width-1` |
| Shadows | `--pav-shadow-*` | `--pav-shadow-sm`, `--pav-shadow-lg` |

### Correct Usage

```scss
.event-card {
  background: var(--pav-surface-card);
  color: var(--pav-text-primary);
  padding: var(--pav-space-6);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  font-size: var(--pav-font-size-base);
}
```

## Site and Widget

The public site and the widget do not use the client's full token system. They follow [DEC-019](../../../agent-os/product/decisions/dec-019-shared-ui-module.md) rules 7 and 10: **a value that varies by theme or by host is a runtime token; a value that does not is a compile-time constant.**

- **Colour, shadow and `color-scheme`** come only from `--pav-*` tokens. `src/common/ui/TOKENS.md` lists them in two tiers: **shared** names, which every app declares and which are the only names a shared component under `src/common/ui` may read, and **public-only** names, which only the site and widget declare. Look a name up there instead of guessing it. The site and widget declare every token in one place, the `public-theme-tokens` mixin in `src/common/ui/assets/mixins.scss`, included only on `#app` (site) and `.widget-root` (widget).
- **Spacing, type, radius, motion and breakpoints** are compile-time `$public-*` constants in the same file. The site and widget do not declare `--pav-space-*` or `--pav-font-size-*`; the client's tokens of those names carry different values. A shared component, which may not read `$public-*`, writes these as plain `rem`.
- `scripts/check-theme-tokens.ts` (part of `npm run lint`) fails on a colour `$public-*` variable, on a dark selector, `prefers-color-scheme` or `color-scheme` outside the token layer, and on an include of `public-theme-tokens` anywhere else.

## Anti-Patterns

### Hardcoded Colors

```scss
// BAD: raw hex/rgb values
.component { color: #666; background: #fff; border: 1px solid #ccc; }

// GOOD: semantic tokens
.component { color: var(--pav-text-secondary); background: var(--pav-surface-primary); border: var(--pav-border-width-1) solid var(--pav-border-primary); }
```

### Hardcoded Spacing

```scss
// BAD: pixel values for spacing
.component { padding: 16px; margin-bottom: 24px; gap: 8px; }

// GOOD: spacing tokens
.component { padding: var(--pav-space-4); margin-block-end: var(--pav-space-6); gap: var(--pav-space-2); }
```

### Hardcoded Typography

```scss
// BAD: raw font values
.heading { font-size: 18px; font-weight: 600; }

// GOOD: typography tokens
.heading { font-size: var(--pav-font-size-lg); font-weight: var(--pav-font-weight-semibold); }
```

### Hardcoded Border Radius

```scss
// BAD: raw radius values
.card { border-radius: 8px; }

// GOOD: radius tokens
.card { border-radius: var(--pav-border-radius-md); }
```

## Known Drift

- Some older components still use hardcoded `px` values for spacing and font sizes
- A few components use raw hex colors instead of semantic tokens
