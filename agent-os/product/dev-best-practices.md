# Development Best Practices

> Version: 1.0.0
> Last updated: 2025-09-12
> Scope: Pavillion project development standards

## Context

This file defines development best practices specific to the Pavillion project. These practices build upon the global Agent OS standards and provide project-specific guidance for maintaining code quality and consistency.

## CSS/SCSS Development Guidelines

### 🚨 **CSS Decision Tree for Engineers & AI Agents**

Before writing any CSS, follow this decision tree to avoid duplicating existing sophisticated systems:

#### **Before Writing Any CSS, Ask:**

1. **"Does this pattern already exist?"** 
   - Check `src/client/assets/style/components/` first
   - Search existing patterns: buttons, modals, forms, layouts
   - **If yes**: Use existing classes, don't reinvent

2. **"Will this be used more than once?"**
   - If **yes**: Create reusable component in `components/`
   - If **no**: Write scoped component CSS using design tokens

3. **"Is this truly new and valuable?"**
   - If **genuinely new**: Extract to component library
   - If **minor variation**: Extend existing system with modifier

#### **🚫 Never Do This:**
```scss
// ❌ Bad: Hardcoded values, one-off styling
.my-dialog {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: #fff;
  padding: 20px;
  z-index: 1000;
}

// ❌ Bad: Custom button variants
.my-button {
  background: #dc3545;
  color: white;
  padding: 8px 16px;
  border-radius: 6px;
}
```

#### **✅ Always Do This:**
```html
<!-- ✅ Good: Use existing sophisticated system -->
<div class="modal__overlay">
  <div class="modal__content modal__content--md">
    <!-- content -->
  </div>
</div>

<!-- ✅ Good: Use existing button system -->
<button class="btn btn--danger">Delete</button>
```

#### **⚡ Quick Reference:**
- **Buttons**: Use `.btn` variants, never custom button CSS
- **Modals/Dialogs**: Use `.modal__*` system, never custom overlays  
- **Spacing**: Use `var(--pav-space-*)` tokens, never hardcoded px
- **Colors**: Use `var(--pav-color-*)` tokens, never hex values
- **New Patterns**: Extract to `components/` if used 2+ times

#### **🔍 Before Coding, Search:**
1. `grep -r "similar-pattern" src/client/assets/style/components/`
2. Check style system README for existing patterns
3. Look at similar components in codebase

#### **📏 Rule of Thumb:**
- **<10 lines CSS + used once** = Component-scoped with design tokens
- **>10 lines CSS OR used 2+ times** = Extract to component library
- **Existing pattern** = Use existing classes, don't duplicate

### CSS Architecture Compliance

#### **Design Token Usage**
```scss
// ✅ Good: Use design tokens
.component {
  color: var(--pav-text-secondary);
  margin: var(--pav-space-4);
  border-radius: var(--pav-border-radius-md);
}

// ❌ Avoid: Hardcoded values
.component {
  color: #666;
  margin: 16px;
  border-radius: 8px;
}
```

#### **CSS Layers Compliance**
- Place new components in `@layer components`
- Ensure utilities can override components
- Never use `!important` - layers handle specificity

#### **Responsive Design**
- Use logical properties for LTR/RTL support (`margin-inline-start` vs `margin-left`)
- Follow mobile-first responsive approach
- Leverage existing breakpoint tokens

## Vue Component Development

### **Component Styling Standards**

#### **Scoped Styles with Design Tokens**
```vue
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

#### **Avoid Custom Implementations**
- Don't create custom modals when `.modal__*` exists
- Don't create custom buttons when `.btn` variants exist
- Don't duplicate existing form controls or navigation patterns

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
- **Global Agent OS Standards**: `@~/.agent-os/standards/`
- **Technical Stack Details**: `@.agent-os/product/tech-stack.md`