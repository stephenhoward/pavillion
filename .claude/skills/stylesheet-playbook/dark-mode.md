# Dark Mode Support

> Version: 1.0.0
> Last Updated: 2026-03-29

Conventions for dark mode and theme support in Pavillion stylesheets.

## Established Convention

Pavillion uses a `data-theme` attribute on the document root for theme switching. Semantic tokens automatically adapt -- components that use semantic tokens get dark mode for free.

### Token Categories and Dark Mode Adaptation

**Base Color Tokens** (`--pav-color-*`) specify raw colors. They do NOT adapt to theme and should only be used in design token definitions or as explicit overrides.

**Semantic Tokens** (`--pav-surface-*`, `--pav-text-*`, `--pav-border-*`) are theme-aware. Use these in component styles. They automatically adapt when `data-theme` changes.

**Components should use semantic tokens, not base colors.**

### Theme Switching Mechanism

```scss
// Light theme (default)
:root {
  --pav-surface-primary: #ffffff;
  --pav-text-primary: #1f2937;
}

// Dark theme
[data-theme="dark"] {
  --pav-surface-primary: #1f2937;
  --pav-text-primary: #f9fafb;
}
```

### Correct Usage

Components use semantic tokens that adapt to the active theme:

```scss
.component {
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
  border-color: var(--pav-border-primary);
}
```

No `@media (prefers-color-scheme: dark)` blocks needed when using semantic tokens.

## Anti-Patterns

### Raw Colors That Break in Dark Mode

```scss
// BAD: hardcoded colors don't adapt to theme
.component {
  background: #ffffff;
  color: #222222;
  border: 1px solid #e5e7eb;
}

// GOOD: semantic tokens adapt automatically
.component {
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
}
```

### Manual Dark Mode Overrides

```scss
// BAD: manually duplicating styles for dark mode
.component {
  background: #fff;
}
[data-theme="dark"] .component {
  background: #1f2937;
}

// GOOD: use a semantic token that handles both
.component {
  background: var(--pav-surface-primary);
}
```

### Using Base Color Tokens Instead of Semantic Tokens

```scss
// BAD: base color doesn't adapt to theme
.component {
  color: var(--pav-color-gray-900);
}

// GOOD: semantic token adapts to theme
.component {
  color: var(--pav-text-primary);
}
```

## Known Drift

- Some components may use base color tokens (e.g., `--pav-color-gray-*`) instead of semantic surface/text tokens
- Older components that predate the theme system may have hardcoded colors
- The site app may have components that don't fully support dark mode
