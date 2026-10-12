# Development Best Practices

> Version: 1.1.0
> Last updated: 2026-02-07
> Scope: Pavillion project development standards

## Context

This file defines development best practices specific to the Pavillion project. These practices build upon the global Agent OS standards and provide project-specific guidance for maintaining code quality and consistency.

## CSS/SCSS Development

**See [CSS Standards](../standards/frontend/css.md)** for the complete CSS decision tree, semantic class patterns, and design token usage.

Key points:
- Search for existing patterns before writing new CSS
- Use design tokens (`var(--pav-*)`) for all values
- Leverage the component library (`.btn`, `.modal__*`, `.card`)
- Extract patterns used 2+ times to the component library

## Domain-Driven Architecture

### **Strict Domain Boundaries**
- Never cross-import between server domains
- Use interface-based communication through `domain.interface`
- Use shared `eventBus` for asynchronous cross-domain communication

### **Entity/Model Separation**
- **Entities** (`src/server/*/entity/`): Pure database with Sequelize, no business logic
- **Models** (`src/common/model/`): Domain logic, usable frontend/backend
- Always use `toModel()` and `fromModel()` methods for conversion

### **API Handler vs Service Separation**
- **API Handlers**: Request/response handling only, no business logic
- **Service Layer**: All business logic, validation, authentication
- Services accept primitive parameters and perform existence checks

## Testing Standards

### **Component Testing**
- Test new SCSS components compile without errors
- Verify CSS output matches expected patterns
- Test responsive behavior across breakpoints
- Validate accessibility compliance (focus states, contrast)

### **Integration Testing**
- Ensure new patterns integrate with existing design system
- Test theme switching (light/dark mode)
- Verify no regressions in existing components

## Pre-commit Checklist

1. **Search for existing patterns** before writing new CSS
2. **Run linter**: `npm run lint` (fix all errors)
3. **Run tests**: `npm test` (ensure 100% pass rate)
4. **Check builds**: `npm run build` (catch compilation errors)
5. **Verify design token usage** - no hardcoded values
6. **Confirm accessibility** - proper focus states and contrast

## Performance Considerations

### **CSS Bundle Optimization**
- Avoid duplicate CSS patterns across components
- Leverage existing sophisticated systems (modals, buttons, forms)
- Use CSS custom properties for theming (no runtime processing)
- Follow tree-shakeable utility patterns

### **Component Reusability**
- Extract patterns used 2+ times to component library
- Prefer extending existing systems over creating new ones
- Document component usage with clear examples

## Migration Guidelines

### **When Updating Existing Components**
1. **Audit current styling** against existing design system
2. **Migrate to established patterns** where possible
3. **Extract genuinely new patterns** to component library
4. **Remove duplicate/inferior CSS** in favor of sophisticated systems
5. **Update tests** to ensure no regressions

### **Code Review Focus Areas**
- Check for hardcoded values instead of design tokens
- Verify use of existing systems (buttons, modals, forms)
- Ensure new patterns are genuinely valuable additions
- Confirm accessibility standards are maintained

## Important Reminders

1. **Leverage existing excellence** - The design system has sophisticated button, modal, and form systems
2. **Avoid variants that serve no valuable purpose** - Don't create duplicate systems
3. **Search first, code second** - Existing patterns cover most use cases
4. **Extract when reused** - If used 2+ times, make it a component
5. **Design tokens always** - Never hardcode colors, spacing, or typography values

This decision tree prevents the "CategorySelectionDialog problem" where engineers write 100+ lines of inferior CSS instead of using existing sophisticated systems.

---

## Additional Resources

- **Style System Documentation**: `src/client/assets/style/README.md`
- **Component Library**: `src/client/assets/style/components/`
- **Project Skills & Standards**: `.claude/skills/`
- **Technical Stack Details**: `@.agent-os/product/tech-stack.md`