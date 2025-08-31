# Pavillion Style System

> **Complete Developer Reference**  
> A unified, semantic-first CSS system with design tokens, components, and utilities.

## 🚀 Essential Info

**The design system is globally available** - no imports needed in Vue components. Use design tokens, semantic HTML, and component classes.

### Current Approach (August 2025)
- **CSS-first philosophy** with minimal SCSS (better performance, future-proof)
- **Semantic HTML5-first** with meaningful element structure
- **CSS custom properties** for all values (colors, spacing, typography)
- **Component classes** for common patterns (`.btn`, `.card`, `.input`)
- **Utility classes** for layout and adjustments (`.flex`, `.m-4`, `.w-full`)
- **CSS layers** for predictable specificity: `reset → tokens → base → layout → components → utilities`
- **Logical properties** for internationalization (LTR/RTL support)

## ✅ Do This

```vue
<template>
  <!-- Semantic HTML structure -->
  <article class="event-card">
    <header>
      <h3>{{ event.title }}</h3>
      <time :datetime="event.date">{{ formatDate(event.date) }}</time>
    </header>
    <p class="text-secondary">{{ event.description }}</p>
    <button class="btn btn--primary" @click="register">Register</button>
  </article>
</template>

<style scoped lang="scss">
.event-card {
  background: var(--pav-surface-card);
  border: var(--pav-border-width-1) solid var(--pav-border-primary);
  border-radius: var(--pav-border-radius-md);
  padding: var(--pav-space-6);
  
  header {
    margin-bottom: var(--pav-space-4);
  }
}
</style>
```

## ❌ Don't Do This

```vue
<!-- Avoid: Non-semantic divs and hardcoded values -->
<div style="background: #fff; padding: 20px; border: 1px solid #ccc;">
  <div style="font-size: 18px; font-weight: bold;">Title</div>
  <div style="color: #666;">Description</div>
</div>
```

## �️ System Architecture

### File Structure
```
src/client/assets/style/
├── main.scss           # Entry point (imported globally)
├── tokens/             # Design tokens (CSS custom properties)
│   ├── _colors.scss        # Brand colors, status colors, surfaces
│   ├── _spacing.scss       # Spacing scale (4px base)
│   ├── _typography.scss    # Font sizes, weights, line heights
│   ├── _borders.scss       # Border widths, radius values
│   ├── _shadows.scss       # Box shadow definitions
│   ├── _elevation.scss     # Material elevation levels
│   └── _breakpoints.scss   # Media query breakpoints
├── themes/             # Theme definitions
│   ├── _light.scss         # Light theme color mappings
│   └── _dark.scss          # Dark theme color mappings
├── base/               # Reset and base element styles
├── components/         # Component classes (.btn, .card, etc.)
│   ├── _buttons.scss       # Button variants and states
│   ├── _cards.scss         # Card layouts and variants
│   ├── _forms.scss         # Input, select, textarea styles
│   ├── _navigation.scss    # Nav, breadcrumb components
│   ├── _modals.scss        # Modal and dialog styles
│   ├── _tables.scss        # Table layouts and styles
│   ├── _alerts.scss        # Alert and notification styles
│   └── [13 other component files]
├── utilities/          # Utility classes (.flex, .m-4, etc.)
│   ├── _layout.scss        # Flexbox, grid, display utilities
│   ├── _spacing.scss       # Margin, padding utilities
│   ├── _typography.scss    # Text size, weight, alignment
│   ├── _visibility.scss    # Show/hide, responsive visibility
│   └── _debug.scss         # Development debugging utilities
├── layout/             # Layout patterns and containers
├── mixins/             # SCSS helper functions
```

### CSS Layers (Specificity Order)

Our styles use CSS `@layer` for predictable cascade control:

```css
@layer reset, tokens, base, layout, components, utilities;
```

**Layer Order (lowest to highest specificity):**

1. **reset** - CSS reset and normalize (box-sizing, margins, etc.)
2. **tokens** - Design tokens (CSS custom properties) and themes  
3. **base** - Base typography and foundational element styles
4. **layout** - Layout systems (grid, flexbox utilities)
5. **components** - Component styles (`.btn`, `.card`, `.modal`)
6. **utilities** - Utility classes (`.m-4`, `.text-center`, `.hidden`)

**Benefits:**
- Eliminates `!important` usage
- Predictable cascade behavior  
- Utilities can always override components
- Clear separation of concerns
- Future-proof architecture

**Browser Support:** Chrome 99+, Firefox 97+, Safari 15.4+ (graceful degradation for older browsers)

## �🎨 Design Tokens Reference

All values are CSS custom properties available globally:

### Colors
```css
/* Brand */
--pav-color-brand-primary: #ff9131;
--pav-color-brand-secondary: #2563eb;

/* Surface & Text */
--pav-surface-primary: #ffffff;
--pav-surface-card: #f8fafc;
--pav-text-primary: #1f2937;
--pav-text-secondary: #6b7280;

/* Status */
--pav-color-success: #10b981;
--pav-color-warning: #f59e0b;
--pav-color-error: #ef4444;
```

### Spacing
```css
--pav-space-1: 0.25rem;   /* 4px */
--pav-space-2: 0.5rem;    /* 8px */
--pav-space-4: 1rem;      /* 16px */
--pav-space-6: 1.5rem;    /* 24px */
--pav-space-8: 2rem;      /* 32px */
--pav-space-12: 3rem;     /* 48px */
```

### Typography
```css
--pav-font-size-sm: 0.875rem;    /* 14px */
--pav-font-size-base: 1rem;      /* 16px */
--pav-font-size-lg: 1.125rem;    /* 18px */
--pav-font-size-xl: 1.25rem;     /* 20px */
--pav-font-size-2xl: 1.5rem;     /* 24px */

--pav-font-weight-normal: 400;
--pav-font-weight-medium: 500;
--pav-font-weight-semibold: 600;
--pav-font-weight-bold: 700;
```

### Borders & Radius
```css
--pav-border-width-1: 1px;
--pav-border-width-2: 2px;

--pav-border-radius-sm: 0.25rem;  /* 4px */
--pav-border-radius-md: 0.5rem;   /* 8px */
--pav-border-radius-lg: 1rem;     /* 16px */
--pav-border-radius-full: 9999px;
```

## 🧩 Component Classes

Pre-built component patterns ready to use:

### Buttons
```html
<button class="btn">Base button</button>
<button class="btn btn--primary">Primary action</button>
<button class="btn btn--secondary">Secondary action</button>
<button class="btn btn--danger">Destructive action</button>
<button class="btn btn--ghost">Subtle action</button>
<button class="btn btn--small">Compact button</button>
```

### Cards & Containers
```html
<div class="card">Basic card container</div>
<div class="card card--elevated">Card with shadow</div>
<div class="container">Page container with max-width</div>
```

### Forms
```html
<input class="input" type="text" placeholder="Text input">
<select class="select">...</select>
<textarea class="textarea"></textarea>
<label class="label">Form label</label>
```

## 🔧 Utility Classes

For layout and quick adjustments:

### Layout
```html
<div class="flex justify-center items-center">Centered content</div>
<div class="grid grid-cols-2 gap-4">Two-column grid</div>
<div class="w-full h-screen">Full width and height</div>
```

### Spacing
```html
<div class="m-4">Margin on all sides</div>
<div class="p-6">Padding on all sides</div>
<div class="mt-8">Top margin only</div>
<div class="space-y-4">Vertical spacing between children</div>
```

### Typography
```html
<h1 class="text-3xl font-bold">Large bold heading</h1>
<p class="text-secondary text-sm">Small secondary text</p>
<div class="text-center">Centered text</div>
```

## 🌍 Internationalization (Logical Properties)

The system uses CSS logical properties for automatic LTR/RTL support:

### Logical vs Physical Properties
| Physical | Logical | Purpose |
|----------|---------|---------|
| `margin-left` | `margin-inline-start` | Start of text direction |
| `margin-right` | `margin-inline-end` | End of text direction |
| `padding-left` | `padding-inline-start` | Text direction aware |
| `text-align: left` | `text-align: start` | Reading direction start |

### Usage
```scss
// ✅ Good: Uses logical properties
.component {
  margin-inline-start: var(--pav-space-4);
  padding-inline: var(--pav-space-2);
  text-align: start;
}

// ❌ Avoid: Physical properties
.component {
  margin-left: var(--pav-space-4);
  padding-left: var(--pav-space-2);
  text-align: left;
}
```

## 🎭 Theming

Automatic light/dark theme support:

```scss
// Themes automatically switch via data attribute
[data-theme="dark"] {
  --pav-surface-primary: #1f2937;
  --pav-text-primary: #f9fafb;
}

// Use semantic tokens that adapt to theme
.my-component {
  background: var(--pav-surface-primary);
  color: var(--pav-text-primary);
}
```

## 🔍 When to Use What

### Use Component Classes When:
- Common UI patterns (buttons, cards, inputs)
- Multiple properties needed together
- Consistent behavior across the app

### Use Utility Classes When:
- Simple layout adjustments
- One-off spacing or sizing needs  
- Prototyping and quick iterations

### Use Custom CSS When:
- Component-specific styling
- Complex animations or interactions
- Unique visual requirements

Always use design tokens in custom CSS:
```scss
// ✅ Good
.custom-component {
  margin: var(--pav-space-4);
  color: var(--pav-text-secondary);
}

// ❌ Avoid
.custom-component {
  margin: 16px;
  color: #666;
}
```

## 🛠️ Development Workflow

### Adding New Components

1. **Create component file**:
```scss
// src/client/assets/style/components/_my-component.scss
.my-component {
  background: var(--pav-surface-card);
  padding: var(--pav-space-4);
  border-radius: var(--pav-border-radius-md);
  
  &--variant {
    background: var(--pav-color-brand-primary);
  }
  
  &__element {
    margin-bottom: var(--pav-space-2);
  }
}
```

2. **Import in main.scss**:
```scss
@layer components {
  @import './components/my-component';
}
```

### Adding Design Tokens

1. **Add to token file**:
```scss
// src/client/assets/style/tokens/_colors.scss
:root {
  --pav-color-info: #17a2b8;
}
```

2. **Create theme mappings**:
```scss
// src/client/assets/style/themes/_light.scss
:root {
  --pav-surface-info: var(--pav-color-info-light);
}
```

### Adding Utilities

```scss
// src/client/assets/style/utilities/_spacing.scss
.m-auto { margin: auto; }
.p-8 { padding: var(--pav-space-8); }
```

## 🏆 Best Practices

### 1. CSS-First Philosophy
- **Use CSS custom properties** for all dynamic values
- **Minimize SCSS usage** to build-time conveniences only
- **Prefer native CSS features** for better performance

### 2. Semantic HTML First
```html
<!-- ✅ Good: Meaningful structure -->
<article class="event-card">
  <header>
    <h3>Event Title</h3>
    <time datetime="2025-08-16">Aug 16, 2025</time>
  </header>
</article>

<!-- ❌ Avoid: Generic divs -->
<div class="event-card">
  <div class="event-title">Event Title</div>
</div>
```

### 3. Design Token Usage
```scss
// ✅ Good: Design tokens
.component {
  color: var(--pav-text-secondary);
  margin: var(--pav-space-4);
}

// ❌ Avoid: Hardcoded values
.component {
  color: #666;
  margin: 16px;
}
```

### 4. Logical Properties for I18n
```scss
// ✅ Good: Logical properties
.component {
  margin-inline-start: var(--pav-space-4);
  text-align: start;
}

// ❌ Avoid: Physical properties
.component {
  margin-left: var(--pav-space-4);
  text-align: left;
}
```

### 5. Layer-Aware Development
- **Components** provide base styling
- **Utilities** override when needed
- **Never use `!important`** - layers handle specificity

## 📋 Migration Summary

This system replaces the previous SCSS mixin approach:

| Old Way | New Way |
|---------|---------|
| `@use '../../assets/mixins'` | No imports needed |
| SCSS variables | CSS custom properties |
| Complex mixins | Component classes + utilities |
| Hardcoded values | Design tokens |
| Div-based structure | Semantic HTML5 |
| Physical properties | Logical properties |

The system is production-ready and globally available. Start using it immediately in any Vue component.
--pav-space-1: 0.25rem;   /* 4px */
--pav-space-2: 0.5rem;    /* 8px */
--pav-space-4: 1rem;      /* 16px */
--pav-space-6: 1.5rem;    /* 24px */
--pav-space-8: 2rem;      /* 32px */
--pav-space-12: 3rem;     /* 48px */
```

### Typography
```css
--pav-font-size-sm: 0.875rem;
--pav-font-size-base: 1rem;
--pav-font-size-lg: 1.125rem;
--pav-font-weight-medium: 500;
```

## 🧩 Components

### Buttons
```html
<button class="btn btn--primary">Primary</button>
<button class="btn btn--secondary">Secondary</button>
<button class="btn btn--ghost">Ghost</button>
```

### Forms
```html
<input class="input" type="text" placeholder="Enter text">
<textarea class="textarea"></textarea>
<select class="select">
  <option>Choose option</option>
</select>
```

### Cards
```html
<div class="card">
  <div class="card__header">
    <h3 class="card__title">Card Title</h3>
  </div>
  <div class="card__content">
    <p class="card__text">Card content goes here.</p>
  </div>
</div>
```

## 🛠 Utilities

### Spacing
```html
<div class="m-4 p-6">Margin 4, Padding 6</div>
<div class="mx-auto">Centered horizontally</div>
```

### Layout
```html
<div class="flex items-center justify-between">
<div class="grid grid-cols-3 gap-4">
<div class="hidden md:block">Hidden on mobile</div>
```

### Typography
```html
<h1 class="text-2xl font-bold">Large bold heading</h1>
<p class="text-sm text-muted">Small muted text</p>
```

## 🌗 Theme Support

### Light Theme (Default)
```css
:root {
  --pav-surface-primary: #ffffff;
  --pav-text-primary: #222;
}
```

### Dark Theme
```css
[data-theme="dark"] {
  --pav-surface-primary: #33333a;
  --pav-text-primary: #ffffff;
}
```

### Toggle Theme
```javascript
document.documentElement.setAttribute('data-theme', 'dark');
```

## 📱 Responsive Design

### Breakpoints
- **sm**: 640px and up
- **md**: 768px and up  
- **lg**: 1024px and up
- **xl**: 1280px and up

### Usage
```scss
.component {
  padding: var(--pav-space-2);
  
  @media (min-width: 768px) {
    padding: var(--pav-space-4);
  }
}
```

## 🎯 CSS Layers

Our styles are organized in layers for predictable cascade:

```css
@layer reset, tokens, base, layout, components, utilities, legacy;
```

**Order (lowest to highest specificity):**
1. **reset** - CSS reset
2. **tokens** - Design tokens
3. **base** - Base typography
4. **layout** - Grid/flexbox
5. **components** - Components (.btn, .card)
6. **utilities** - Utilities (.m-4, .hidden)
7. **legacy** - Migration compatibility

## 🏗 File Structure

```
src/client/assets/style/
├── main.scss                 # Entry point
├── tokens/                   # Design tokens
├── themes/                   # Light/dark themes
├── base/                     # Reset and base styles
├── layout/                   # Grid and flexbox
├── components/               # Component library
├── utilities/                # Utility classes
└── legacy/                   # Migration support
```

## 🎨 Naming Conventions

### Components (BEM-inspired)
```css
.btn { }                      /* Block */
.btn--primary { }             /* Modifier */
.card__header { }             /* Element */
.card__title--large { }       /* Element modifier */
```

### Utilities (Tailwind-inspired)
```css
.m-4 { }                      /* margin */
.p-6 { }                      /* padding */
.text-lg { }                  /* font-size */
.flex { }                     /* display */
```

### Design Tokens
```css
--pav-{category}-{property}-{variant}
--pav-color-brand-primary
--pav-space-md
--pav-font-size-xl
```

## ⚡ Performance

### CSS Layers Support
- **Modern browsers**: Explicit layer ordering
- **Older browsers**: Document order (graceful degradation)

### Bundle Optimization
- CSS custom properties (no runtime processing)
- Tree-shakeable utilities
- Minimal SCSS compilation

## 🧪 Development

### Adding Components
1. Create file in `components/`
2. Import in main.scss
3. Follow BEM naming
4. Use design tokens

### Adding Utilities
1. Add to appropriate utility file
2. Follow naming convention
3. Import in main.scss

### Testing
```bash
npm run dev          # Start development server
npm run build        # Build for production
npm run lint         # Check code quality
```

## 🔄 Migration

### From Legacy Styles
1. Replace hardcoded values with design tokens
2. Convert to BEM naming convention
3. Use utility classes for spacing/layout
4. Remove old styles after testing

### Example Migration
```scss
/* Before */
.my-button {
  background: #ff9131;
  padding: 8px 16px;
}

/* After */
.btn {
  background-color: var(--pav-color-brand-primary);
  padding: var(--pav-space-2) var(--pav-space-4);
}
```

## 🆘 Troubleshooting

### Common Issues

**Utilities not overriding components?**
- Check CSS layer order in main.scss
- Ensure utilities layer comes after components

**Styles not updating across themes?**
- Use semantic tokens instead of base colors
- Check theme token assignments

**Need debugging help?**
- Add `.debug-layers` class to see layer info
- Use browser DevTools CSS layers panel

## 📚 Resources

### Learning
- [CSS Layers Guide](https://developer.mozilla.org/en-US/docs/Web/CSS/@layer)
- [CSS Custom Properties](https://developer.mozilla.org/en-US/docs/Web/CSS/--*)
- [BEM Methodology](https://getbem.com/)

### Tools
- [CSS Layers Browser Support](https://caniuse.com/css-cascade-layers)
- [Design Tokens W3C Spec](https://design-tokens.github.io/community-group/)

---

## 🤝 Contributing

1. Read the [DEVELOPMENT_GUIDE.md](./DEVELOPMENT_GUIDE.md)
2. Follow naming conventions
3. Use design tokens
4. Test in both themes
5. Update documentation
