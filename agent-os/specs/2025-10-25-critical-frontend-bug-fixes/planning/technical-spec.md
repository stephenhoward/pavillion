# Technical Specification

This is the technical specification for the spec detailed in @agent-os/specs/2025-10-25-critical-frontend-bug-fixes/spec.md

> Created: 2025-10-25
> Version: 1.0.0

## Bug 1: SearchFilter Component Null Reference Error

### Technical Requirements

- Add null/undefined safety checks before accessing `category.content.language`
- Ensure component handles categories with missing or null content gracefully
- Maintain existing functionality for categories with valid content
- No impact on search/filter performance

### Location

**File:** `src/client/components/logged_in/calendar/SearchFilter.vue`
**Line:** 227

### Current Code Analysis

```typescript
// Current problematic code (approximate):
category.content(i18n.language)?.name
// or
category.content.language
```

The error occurs because `category.content` can be undefined/null, but the code attempts to access properties on it without checking.

### Proposed Fix

**Option A: Optional Chaining (Recommended)**
```typescript
category.content?.(i18n.language)?.name ?? ''
```

**Option B: Explicit Null Check**
```typescript
category.content && category.content(i18n.language)?.name || ''
```

**Rationale:** Option A is more concise and follows modern JavaScript patterns. The `?.` operator safely handles null/undefined values.

### Testing Requirements

- Verify search filter works with categories that have valid content
- Verify search filter doesn't crash with categories that have null/undefined content
- Check browser console has no errors during category filtering
- Test with multilingual categories

## Bug 2: Font Loading 404 Errors

### Technical Requirements

- Fix double slash in font file paths
- Ensure all 3 font files load with 200 OK status:
  - CreatoDisplay-Regular.otf
  - CreatoDisplay-Medium.otf
  - CreatoDisplay-Light.otf
- No visual regression in typography

### Location

**Files to Check:**
- `src/client/assets/style/**/*.scss`
- `src/site/assets/style/**/*.scss`
- Font declaration files (likely in `tokens/` or similar)

### Current Issue Analysis

Current paths return 404:
```
//src/client/assets/fonts/CreatoDisplay-Regular.otf
//src/client/assets/fonts/CreatoDisplay-Medium.otf
//src/client/assets/fonts/CreatoDisplay-Light.otf
```

The double slash `//` at the beginning makes the browser interpret these as protocol-relative URLs instead of relative paths.

### Proposed Fix

**Search and Replace Pattern:**
```scss
// Find:
url(//src/client/assets/fonts/
// Replace with:
url(/src/client/assets/fonts/

// Or if using relative paths:
url(../../fonts/
```

**Vite Configuration Check:**
May also need to verify Vite's asset handling configuration for fonts.

### Testing Requirements

- All font files load with 200 OK in browser Network tab
- Typography renders correctly in both light and dark modes
- No console errors related to fonts
- Visual QA: fonts display as intended (not falling back to system fonts)

## Bug 3: Calendar Management Page Null Data

### Technical Requirements

- Investigate why calendar data returns null on management page
- Fix data loading mechanism to properly fetch calendar data
- Ensure calendar ID/URL name is correctly passed to API
- Display calendar information in management UI

### Location

**Frontend Components:**
- Calendar management page component (exact path needs investigation)
- Calendar data loading logic

**Backend APIs:**
- Verify `/api/v1/calendars/:id` or similar endpoint works correctly

### Investigation Steps

1. Check browser Network tab for API calls on management page
2. Identify which endpoint is being called
3. Verify endpoint returns data (test with curl/Postman)
4. Check frontend component props/state for calendar data
5. Verify calendar ID/URL name is available in Vue router params

### Potential Root Causes

**Hypothesis 1: API Call Failure**
- API endpoint not being called
- API returning 404 or error
- Authentication issue

**Hypothesis 2: Data Mapping Issue**
- API returns data but component doesn't map it correctly
- Missing reactive properties
- Async timing issue

**Hypothesis 3: Routing Issue**
- Calendar ID not in route params
- Route params not passed to component
- Wrong calendar ID being used

### Proposed Investigation Approach

1. Add console.log to track calendar data flow
2. Check if calendar ID is in route (router params)
3. Verify API call is made and succeeds
4. Check component's mounted/created hooks
5. Review Pinia store if calendar data is stored there

### Testing Requirements

- Calendar management page loads with actual calendar data
- Calendar name, URL name, and settings display correctly
- Category management section is accessible
- No "null" or "undefined" displayed to user
- Browser console shows no errors

## External Dependencies

None - All fixes use existing libraries and patterns in the codebase.

## Implementation Notes

### Code Style

- Follow Vue 3 composition API patterns
- Use TypeScript type safety
- Add null checks using modern JavaScript optional chaining
- Maintain existing SCSS formatting conventions

### Testing Strategy

- Fix each bug incrementally
- Test immediately after each fix
- Run full test suite after all fixes
- Perform manual browser QA for each bug
- Check browser console for any new errors

### Rollback Plan

All changes are non-breaking and additive (null checks, path fixes). If issues arise:
1. Revert specific file changes via git
2. Test individually
3. Re-apply fixes with adjustments
