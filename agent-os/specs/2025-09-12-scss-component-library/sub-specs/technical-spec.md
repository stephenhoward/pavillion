# Technical Specification

This is the technical specification for the spec detailed in @.agent-os/specs/2025-09-12-scss-component-library/spec.md

> Created: 2025-09-12
> Version: 1.0.0

## Technical Requirements

- Extract component patterns while maintaining backward compatibility with existing mixins.scss structure and build process
- Create systematic naming convention following BEM methodology for component mixins with consistent prefixes and parameter patterns
- Implement responsive design patterns that work consistently across mobile and desktop breakpoints defined in the existing system
- Ensure proper CSS custom property integration for theme support using existing light/dark mode token architecture
- Maintain accessibility standards with proper focus states and ARIA-compatible styling patterns
- Create comprehensive documentation comments for each mixin with usage examples and parameter descriptions
- Follow CSS layers architecture (reset → tokens → base → layout → components → utilities) as defined in style system README
- Utilize existing design tokens and logical properties for internationalization support

## File Structure

```
src/client/assets/style/
├── components/                    # Existing component directory
│   ├── _floating-actions.scss    # NEW: Floating action bar patterns
│   ├── _filter-controls.scss     # NEW: Search and filter UI patterns
│   ├── _buttons.scss              # EXISTING: Already comprehensive system
│   ├── _modals.scss               # EXISTING: Already comprehensive system
│   └── _dialogs.scss              # EXISTING: Already comprehensive system
└── main.scss                     # Import only new floating-actions and filter-controls
```

## Component Integration Strategy

- Leverage existing CSS custom properties and design token system
- Follow established @layer components pattern for predictable cascade
- Use semantic HTML-first approach with component classes as documented in README
- Maintain compatibility with current Vite build process and SCSS compilation
- Ensure new patterns work with existing dark-mode CSS custom property switching

## Patterns Analysis

**Floating Action Bar** (NEW): Fixed positioning with slide-up animations, responsive stacking, proper z-index management - genuinely new pattern worth extracting

**Filter Controls** (NEW): Search inputs with integrated clear buttons, category chip selection, responsive filter layouts - valuable new reusable patterns

**Dialog Components** (MIGRATE): CategorySelectionDialog uses ad-hoc styling inferior to existing comprehensive modal/dialog system - should migrate to existing classes

**Button Components** (MIGRATE): All custom button styling should migrate to existing comprehensive button system which already includes all needed variants

## Component Migration/Conformance Plan

### BulkOperationsMenu.vue Migration:
- **Remove**: Custom `.secondary`, `.danger`, `.tertiary` button styles (~50 lines CSS)
- **Replace with**: `.btn--secondary`, `.btn--danger`, `.btn--ghost` classes
- **Benefit**: Consistent theming, accessibility, focus states, size variants

### CategorySelectionDialog.vue Migration:
- **Remove**: Custom `.dialog-overlay`, `.dialog`, `.dialog-header`, `.dialog-footer` (~120 lines CSS)
- **Replace with**: `.modal__overlay`, `.modal__content`, existing header/footer patterns
- **Remove**: Custom `.primary`, `.tertiary` button styles
- **Replace with**: `.btn--primary`, `.btn--ghost`
- **Benefit**: Animation system, responsive sizing, accessibility features, reduced code

### SearchFilter.vue Migration:
- **Remove**: Custom `.clear-search`, `.clear-all-filters` button styling
- **Replace with**: `.btn--ghost` or `.btn--icon` variants
- **Benefit**: Consistent button behavior and theming

### Expected Code Reduction:
- **~200 lines of duplicate/inferior CSS eliminated**
- **3-4 Vue components updated to use design system**
- **Improved accessibility and consistency**

## Approach

**Selected Approach: Component-Based SCSS Library with Mixin Architecture**

- Create dedicated component files that export focused mixins for specific UI patterns
- Maintain existing mixins.scss for foundational utilities while adding component-specific patterns
- Use consistent naming conventions with `@mixin component-name--variant()` pattern
- Implement proper CSS layers to ensure predictable cascade and override behavior
- Document each mixin with usage examples and parameter documentation

**Rationale:** This approach provides the best balance of organization, reusability, and maintainability while preserving existing functionality and build processes.

## External Dependencies

No new external dependencies required. The component library will utilize:

- **Existing SCSS compilation**: Current Vite + Sass build process
- **Design token system**: Established CSS custom properties for theming
- **CSS layers**: Already implemented cascade layer architecture
- **Responsive utilities**: Current breakpoint and spacing token system