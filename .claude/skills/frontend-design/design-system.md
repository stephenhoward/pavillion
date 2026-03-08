# Design System

The Pavillion design system is a CSS-first system with design tokens, semantic classes, and pre-built components.

## Quick Start

- **Standards & Decision Tree**: See [CSS Standards](./css.md)
- **Full Token Reference**: See `src/client/assets/style/README.md`
- **Component Library**: See `src/client/assets/style/components/`

## Core Principles

1. **Design tokens for all values** - Use `var(--pav-*)` tokens, never hardcoded values
2. **Semantic classes** - Classes describe purpose, not appearance
3. **CSS layers** - Predictable specificity without `!important`
4. **Auto-theming** - Tokens adapt to light/dark mode automatically

## Token Categories

| Category | Prefix | Example |
|----------|--------|---------|
| Colors | `--pav-color-*`, `--pav-surface-*`, `--pav-text-*` | `var(--pav-surface-card)` |
| Spacing | `--pav-space-*` | `var(--pav-space-4)` |
| Typography | `--pav-font-size-*`, `--pav-font-weight-*` | `var(--pav-font-size-lg)` |
| Borders | `--pav-border-radius-*`, `--pav-border-width-*` | `var(--pav-border-radius-md)` |
| Shadows | `--pav-shadow-*` | `var(--pav-shadow-md)` |
