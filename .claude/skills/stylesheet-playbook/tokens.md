# Design Token Usage

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for design token usage in Pavillion stylesheets.

## Established Convention

All visual values (colors, spacing, typography, borders, shadows) must use CSS custom properties from the `--pav-*` token system. Tokens are globally available -- no imports needed.

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
- The `site/` app may have components that predate the token system
