# Category CRUD Fixes - Requirements Document

## Spec: Fix Category Management Update and Delete Operations
**Created**: 2025-11-09
**Status**: Planning

## Overview

Fix category UPDATE and DELETE operations that are currently failing with 404 errors. The frontend expects calendar-scoped routes that don't exist in the backend, causing all edit and delete operations to fail.

## User Stories

### Calendar Editor Managing Categories

As a calendar editor, I want to update category names so that I can improve organization and fix typos without recreating categories from scratch.

**Current Workflow (Broken):**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Edit" button on a category
3. Editor changes the category name
4. Editor clicks "Save Changes"
5. ❌ Error: "Error updating category" appears
6. Category name is NOT updated

**Expected Workflow:**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Edit" button on a category
3. Editor changes the category name
4. Editor clicks "Save Changes"
5. ✅ Success message appears
6. Category name is updated in the list
7. Events assigned to this category reflect the new name

### Calendar Editor Deleting Categories

As a calendar editor, I want to delete unused categories so that I can keep my category list clean and relevant.

**Current Workflow (Broken):**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Delete" button on a category
3. Confirmation dialog appears: "Are you sure you want to delete '[Category Name]'?"
4. Editor clicks "Delete" to confirm
5. ❌ Error: "Failed to delete category" appears
6. Category is NOT removed from the list

**Expected Workflow:**
1. Editor navigates to Calendar Management > Categories tab
2. Editor clicks "Delete" button on a category
3. Confirmation dialog appears
4. Editor clicks "Delete" to confirm
5. ✅ Category disappears from the list
6. Events that had this category assigned are updated (category removed)

## Spec Scope

1. **Add Calendar-Scoped UPDATE Route** - Implement `PUT /api/v1/calendars/:calendarId/categories/:categoryId` endpoint to match frontend expectations
2. **Add Calendar-Scoped DELETE Route** - Implement `DELETE /api/v1/calendars/:calendarId/categories/:categoryId` endpoint to match frontend expectations
3. **Remove Backward-Compatible Routes** - Remove the unused `/api/v1/categories/:categoryId` routes for UPDATE and DELETE operations
4. **Verify Permission Checks** - Ensure calendar editor permissions work correctly with the new calendar-scoped routes
5. **Test Category-Event Relationships** - Verify that category assignments to events continue working after the route changes

## Out of Scope

- Frontend modifications (no changes needed - frontend already expects calendar-scoped routes)
- Changes to CREATE or READ operations (already working correctly)
- UI/UX improvements to category management interface
- Category assignment workflow changes
- Migration or data transformation

## Expected Deliverable

1. **Category UPDATE works in browser**: Editor can successfully edit category names through the category management interface without errors
2. **Category DELETE works in browser**: Editor can successfully delete categories through the category management interface without errors
3. **Permission checks verified**: Only calendar editors can update/delete categories for their calendars
4. **Event assignments verified**: Categories assigned to events continue to work correctly after route changes
5. **All category tests pass**: Unit and integration tests for category CRUD operations pass

## Technical Details

See `planning/investigation-findings.md` for complete technical analysis.

### Key Implementation Points

**Backend Route Changes (src/server/calendar/api/v1/categories.ts):**
- Add: `PUT /calendars/:calendarId/categories/:categoryId` → `updateCategory()`
- Add: `DELETE /calendars/:calendarId/categories/:categoryId` → `deleteCategory()`
- Remove: `PUT /categories/:categoryId` → `updateCategoryById()`
- Remove: `DELETE /categories/:categoryId` → `deleteCategoryById()`
- Remove: `GET /categories/:categoryId` → `getCategoryById()`
- Remove: `GET /categories/:categoryId/events` → `getCategoryEventsById()`

**Service Layer:**
- May need to extract calendar ID from route params instead of looking it up from category
- Permission checks should validate calendar editor access using calendar ID

**Testing:**
- Verify all CRUD operations through browser
- Test permission enforcement (non-editors cannot modify categories)
- Verify category-event assignment integrity
- Run existing category unit/integration tests
