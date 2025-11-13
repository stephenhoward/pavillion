# Specification: Category Management CRUD Fixes

## Goal

Fix category UPDATE and DELETE operations that currently fail with 404 errors by adding calendar-scoped routes to the backend that match frontend expectations. This will enable calendar editors to successfully update category names and delete categories through the category management interface.

## User Stories

### Calendar Editor Updating Category Names

As a calendar editor, I want to update category names so that I can improve organization and fix typos without recreating categories from scratch.

**Current Workflow (Broken):**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Edit" button on a category
3. Editor changes the category name
4. Editor clicks "Save Changes"
5. Error: "Error updating category" appears (404 Not Found)
6. Category name is NOT updated

**Expected Workflow:**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Edit" button on a category
3. Editor changes the category name
4. Editor clicks "Save Changes"
5. Success message appears
6. Category name is updated in the list
7. Events assigned to this category reflect the new name

### Calendar Editor Deleting Unused Categories

As a calendar editor, I want to delete unused categories so that I can keep my category list clean and relevant.

**Current Workflow (Broken):**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Delete" button on a category
3. Confirmation dialog appears
4. Editor clicks "Delete" to confirm
5. Error: "Failed to delete category" appears (404 Not Found)
6. Category is NOT removed from the list

**Expected Workflow:**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Delete" button on a category
3. Confirmation dialog appears
4. Editor clicks "Delete" to confirm
5. Category disappears from the list
6. Events that had this category assigned are updated (category removed)

## Core Requirements

- **Calendar-Scoped UPDATE Route**: Implement `PUT /api/v1/calendars/:calendarId/categories/:categoryId` endpoint that accepts calendar ID and category ID to update category content
- **Calendar-Scoped DELETE Route**: Implement `DELETE /api/v1/calendars/:calendarId/categories/:categoryId` endpoint that accepts calendar ID and category ID to delete a category
- **Calendar-Scoped GET Route**: Implement `GET /api/v1/calendars/:calendarId/categories/:categoryId` endpoint for consistency (currently frontend expects this route)
- **Permission Enforcement**: Ensure all new routes verify that the requesting user has editor permissions for the specified calendar
- **Backward-Compatible Route Removal**: Remove the unused backward-compatible routes (`PUT /api/v1/categories/:categoryId`, `DELETE /api/v1/categories/:categoryId`, `GET /api/v1/categories/:categoryId`, `GET /api/v1/categories/:categoryId/events`) to eliminate confusion

## Visual Design

**Reference Screenshots:**
- Update error behavior: `planning/visuals/update-error.png` (not found, but documented in requirements)
- Delete error behavior: `planning/visuals/delete-error.png` (not found, but documented in requirements)

The fix is backend-only and requires no UI changes - the frontend already expects the correct routes.

## Reusable Components

### Existing Code to Leverage

**Backend Route Handlers:**
- `CategoryRoutes.getCategories()` - Pattern for calendar-scoped list operation (lines 47-70)
- `CategoryRoutes.createCategory()` - Pattern for calendar-scoped create with permissions (lines 76-107)
- `CategoryRoutes.updateCategoryById()` - Existing logic for update operation (lines 137-174)
- `CategoryRoutes.deleteCategoryById()` - Existing logic for delete operation (lines 180-216)

**Service Layer (CategoryService):**
- `categoryService.updateCategory(account, categoryId, updateData, calendarId?)` - Service method that accepts optional calendarId (interface line 194)
- `categoryService.deleteCategory(account, categoryId, calendarId?)` - Service method that accepts optional calendarId (interface line 198)
- `categoryService.getCategory(categoryId, calendarId?)` - Service method that accepts optional calendarId (interface line 183)

**Frontend Service (Already Working):**
- `CategoryService.saveCategory()` - Already calls `PUT /api/v1/calendars/:calendarId/categories/:categoryId` (lines 74-105)
- `CategoryService.deleteCategory()` - Already calls `DELETE /api/v1/calendars/:calendarId/categories/:categoryId` (lines 132-145)
- `CategoryService.getCategory()` - Already calls `GET /api/v1/calendars/:calendarId/categories/:categoryId` (lines 113-124)

### New Components Required

**New Route Handlers:**
- `updateCategory()` - Calendar-scoped wrapper for update operation
- `deleteCategory()` - Calendar-scoped wrapper for delete operation
- `getCategory()` - Calendar-scoped wrapper for get operation (for consistency)

These will wrap the existing service layer methods and extract calendar context from route parameters.

## Technical Approach

### Route Implementation Strategy

Add three new route handlers in `src/server/calendar/api/v1/categories.ts` that:

1. Extract both `calendarId` and `categoryId` from route parameters
2. Verify calendar exists (ID or URL name lookup)
3. Call existing service methods with explicit `calendarId` parameter
4. Handle errors consistently with existing patterns

**Calendar-Scoped GET Route (NEW):**
```
GET /api/v1/calendars/:calendarId/categories/:categoryId
→ CategoryRoutes.getCategory()
→ categoryService.getCategory(categoryId, calendarId)
```

**Calendar-Scoped UPDATE Route (NEW):**
```
PUT /api/v1/calendars/:calendarId/categories/:categoryId
→ CategoryRoutes.updateCategory()
→ categoryService.updateCategory(account, categoryId, updateData, calendarId)
```

**Calendar-Scoped DELETE Route (NEW):**
```
DELETE /api/v1/calendars/:calendarId/categories/:categoryId
→ CategoryRoutes.deleteCategory()
→ categoryService.deleteCategory(account, categoryId, calendarId)
```

### Service Layer Pattern

The service layer already supports optional `calendarId` parameter for validation:
- When `calendarId` is provided, service uses it for permission checks
- When `calendarId` is omitted, service looks up calendar ID from category

The new routes will provide explicit `calendarId` from route parameters.

### Permission Verification

All protected routes use:
- `ExpressHelper.loggedInOnly` middleware to ensure authenticated user
- Service layer checks calendar editor permissions via `userCanModifyCalendar()`
- Calendar lookup supports both UUID and URL name for flexibility

### Error Handling

Follow existing error handling patterns:
- `404` for `CalendarNotFoundError`, `CategoryNotFoundError`
- `403` for `InsufficientCalendarPermissionsError`
- `400` for missing authentication
- `500` for unexpected errors

### Route Registration

Update `installHandlers()` to add new routes after CREATE operation:
```typescript
// Line 26-27 (after POST route)
router.get('/calendars/:calendarId/categories/:categoryId', this.getCategory.bind(this));
router.put('/calendars/:calendarId/categories/:categoryId', ExpressHelper.loggedInOnly, this.updateCategory.bind(this));
router.delete('/calendars/:calendarId/categories/:categoryId', ExpressHelper.loggedInOnly, this.deleteCategory.bind(this));
```

Remove backward-compatible routes (lines 29-32):
```typescript
// DELETE these lines:
router.get('/categories/:categoryId', this.getCategoryById.bind(this));
router.put('/categories/:categoryId', ExpressHelper.loggedInOnly, this.updateCategoryById.bind(this));
router.delete('/categories/:categoryId', ExpressHelper.loggedInOnly, this.deleteCategoryById.bind(this));
router.get('/categories/:categoryId/events', this.getCategoryEventsById.bind(this));
```

## Out of Scope

- Frontend modifications (no changes needed - frontend already expects calendar-scoped routes)
- Changes to CREATE or LIST operations (already working correctly)
- UI/UX improvements to category management interface
- Category assignment workflow changes
- Migration or data transformation
- Changes to service layer implementation (already supports optional calendarId)
- Modifications to category-event assignment routes (working correctly)

## Success Criteria

### Functional Requirements
1. **UPDATE operation succeeds**: Calendar editors can edit category names through the category management UI without 404 errors
2. **DELETE operation succeeds**: Calendar editors can delete categories through the category management UI without 404 errors
3. **GET operation succeeds**: Frontend can fetch individual category details using calendar-scoped route
4. **Permission enforcement verified**: Non-editors cannot update/delete categories for calendars they don't have access to
5. **Category-event assignments intact**: Events assigned to categories continue working after route changes

### Technical Requirements
1. **All category tests pass**: Existing unit and integration tests for category CRUD operations pass without modification
2. **No breaking changes**: Category assignment routes continue working unchanged
3. **Code consistency**: New routes follow same patterns as existing calendar-scoped routes (GET, POST)
4. **Clean codebase**: Backward-compatible routes removed to eliminate confusion

### Browser Testing Checklist
- [ ] Create a new category (verify existing functionality still works)
- [ ] Edit category name and save successfully (verify fix works)
- [ ] Delete a category successfully (verify fix works)
- [ ] Attempt to edit category from different user (verify permission denial)
- [ ] Verify events with assigned categories display correctly
- [ ] Verify category filtering works after category rename
- [ ] Verify bulk category assignment continues working

## Reusable Patterns Identified

### Calendar Context Resolution Pattern
```typescript
// Pattern used in getCategories(), createCategory()
let calendar = await this.service.getCalendar(calendarId);
if (!calendar) {
  // Try getting by URL name if ID lookup failed
  calendar = await this.service.getCalendarByName(calendarId);
}

if (!calendar) {
  res.status(404).json({ "error": "calendar not found" });
  return;
}
```

This pattern should be reused in all three new route handlers.

### Authentication Check Pattern
```typescript
// Pattern used in all protected routes
const account = req.user as Account;

if (!account) {
  res.status(400).json({
    "error": "missing account for [operation]. Not logged in?",
  });
  return;
}
```

This pattern should be reused in UPDATE and DELETE handlers.

### Error Response Pattern
```typescript
// Comprehensive error handling from updateCategoryById()
try {
  // operation logic
} catch (error) {
  console.error('Error [operation]:', error);

  if (error instanceof CategoryNotFoundError) {
    res.status(404).json({ "error": "Category not found", "errorName": "CategoryNotFoundError" });
    return;
  }

  if (error instanceof CalendarNotFoundError) {
    res.status(404).json({ "error": "Calendar not found", "errorName": "CalendarNotFoundError" });
    return;
  }

  if (error instanceof InsufficientCalendarPermissionsError) {
    res.status(403).json({ "error": "Permission denied", "errorName": "InsufficientCalendarPermissionsError" });
    return;
  }

  res.status(500).json({ "error": "Internal server error" });
}
```

This comprehensive pattern should be reused in all new handlers.
