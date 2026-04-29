# Dark Mode Support

> Version: 1.1.0
> Last Updated: 2026-04-29

Conventions for dark mode and theme support in Pavillion stylesheets.

## Established Convention

Pavillion uses a `data-theme` attribute on the document root for theme switching. Semantic tokens automatically adapt -- components that use semantic tokens get dark mode for free.

### Token Categories and Dark Mode Adaptation

**Base Color Tokens** (`--pav-color-*`) specify raw colors. They do NOT adapt to theme and should only be used in design token definitions or as explicit overrides.

**Semantic Tokens** (`--pav-surface-*`, `--pav-text-*`, `--pav-border-*`) are theme-aware. Use these in component styles. They automatically adapt when `data-theme` changes.

**Components should use semantic tokens, not base colors.**

## Two Layers, Two Patterns

Theme support spans two distinct authoring layers, and each layer has its own pattern. Mixing them is the most common dark-mode regression.

| Layer | Where it lives | Pattern |
| --- | --- | --- |
| **Token-definition layer** | `src/client/assets/style/tokens/*.scss`, `src/client/assets/style/themes/*.scss` | **Dual mechanism**: `:root` + `[data-theme="dark"]` + `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` |
| **Component-style layer** | `src/client/assets/style/components/*.scss`, `.vue` `<style>` blocks | `var(--pav-*)` references only -- **no `@media` blocks** |

The rest of this doc is split along that boundary: the token-definition section documents the dual mechanism, and the component-style section (Correct Usage + Anti-Patterns) documents the "semantic tokens only, no `@media`" rule.

### Token-Definition Layer

When defining a **theme-adaptive token** (a token whose resolved value differs between light and dark), use all three blocks together:

```scss
:root {
  --pav-token: <light-value>;
}

[data-theme="dark"] {
  --pav-token: <dark-value>;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --pav-token: <dark-value>;
  }
}
```

Each block carries a specific responsibility:

- `:root` -- the light-mode default and the value used when no theme is resolved.
- `[data-theme="dark"]` -- honors a **manual** dark-mode toggle, regardless of OS preference.
- `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` -- honors **OS preference** when the user has not explicitly chosen `light` via the manual toggle. The `:not([data-theme="light"])` guard is what prevents OS preference from overriding a deliberate user choice.

Without all three blocks, app state and OS preference can diverge: a user with manual `[data-theme="light"]` on a dark-OS device would still see the dark-mode value, and a user with no manual toggle on a dark-OS device would see the light-mode value. The dual mechanism eliminates both gaps.

#### Canonical example: `--pav-shadow-focus-brand`

The brand-orange focus-ring token in `src/client/assets/style/tokens/_shadows.scss` is the reference implementation:

```scss
:root {
  --pav-shadow-focus-brand: 0 0 0 3px var(--pav-color-orange-700); /* ~5.6:1 vs white */
}

[data-theme="dark"] {
  --pav-shadow-focus-brand: 0 0 0 3px var(--pav-color-orange-300); /* ~9:1 vs stone-900 */
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --pav-shadow-focus-brand: 0 0 0 3px var(--pav-color-orange-300);
  }
}
```

The `[data-theme="dark"]` and `@media` blocks resolve to the same value -- this is intentional. They are **two delivery channels** for the same dark-mode value, not two different values. Keep them in sync.

### Theme Switching Mechanism

The base semantic surface and text tokens follow the same dual-mechanism pattern; only the simple form is shown here for brevity:

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

In production token files, the `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` block accompanies the `[data-theme="dark"]` block as documented above.

### Component-Style Layer

Component code references semantic tokens directly and never repeats the dual mechanism. A component that needs theme-adaptive colors should always be able to express its needs with a `var(--pav-*)` reference; if it cannot, the gap is in the token layer, not the component layer.

#### Correct Usage

Components use semantic tokens that adapt to the active theme:

```scss
.component {
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
  border-color: var(--pav-border-primary);
}
```

No `@media (prefers-color-scheme: dark)` blocks needed when using semantic tokens. The dual mechanism lives in the token-definition layer; component code never repeats it.

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
