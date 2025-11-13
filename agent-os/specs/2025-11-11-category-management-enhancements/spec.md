# Specification: Category Management Enhancements

> Spec: Category Management Enhancements
> Created: 2025-11-11
> Status: Planning

## Goal

Enhance the category management interface with advanced tools for calendar owners to maintain organized event categories through deletion with migration options, category merging, and usage statistics.

## User Stories

### Story 1: Delete Category with Event Migration Options

As a calendar owner, I want to delete a category I no longer need with the choice to either remove it from events or migrate those events to another category, so that I can keep my categories organized without losing event categorization.

**Acceptance Criteria:**
- When I click delete on a category, a dialog shows the number of affected events
- I can choose between removing the category from all events or migrating events to a different category
- If I choose migration, I can select the target category from a dropdown
- The deletion only proceeds after I explicitly confirm my choice
- After deletion, the category is removed and events are updated according to my choice
- The category list refreshes to show the updated state

### Story 2: Merge Multiple Categories

As a calendar owner, I want to merge multiple similar categories into one, so that I can consolidate duplicate or overlapping categorization without manually reassigning events.

**Acceptance Criteria:**
- I can select multiple categories (2 or more) from the category list using checkboxes
- A "Merge Categories" button appears when multiple categories are selected
- When I click merge, a dialog shows all selected categories with their event counts
- I can choose which category becomes the target (default is the first selected)
- The dialog shows the total number of events that will be affected
- After confirming, all events from source categories are assigned to the target category
- Source categories are deleted and only the target category remains
- The category list refreshes to show the merged result

### Story 3: View Category Usage Statistics

As a calendar owner, I want to see how many events are assigned to each category, so that I can understand which categories are most used and identify unused categories.

**Acceptance Criteria:**
- Event counts appear inline next to each category name in the list
- Counts are displayed in a consistent format (e.g., "Category Name (23)")
- Counts update automatically when categories are added, deleted, or merged
- No additional clicks or navigation required to see the counts

## Core Requirements

### Category Deletion with Migration

**Behavior:**
- Delete dialog must show: category name, affected event count, two mutually exclusive options
- **Option A: Remove Assignments** - Removes category from all events, events remain unchanged otherwise
- **Option B: Migrate to Category** - Shows dropdown of other categories, transfers all assignments to selected category
- Confirmation button disabled until user selects an option
- Migration dropdown excludes the category being deleted
- Backend performs deletion in a transaction to ensure data consistency

**UI Components:**
- Modal dialog with radio buttons for option selection
- Dropdown selector for target category (shown only when migration option selected)
- Confirmation and cancel buttons
- Event count prominently displayed

### Category Merging

**Behavior:**
- Bulk selection via checkboxes on each category item
- Merge button appears only when 2+ categories selected
- Merge dialog shows all selected categories with individual event counts
- Radio buttons to choose which category becomes the target
- First selected category is the default target
- Shows total affected event count
- Backend performs merge in a transaction: reassign all events, then delete source categories
- Target category's translations remain unchanged (no translation merging)

**UI Components:**
- Checkbox on each category item for selection
- "Merge Categories" button (shown when multiple selected)
- Modal dialog with category list, radio buttons for target selection
- Total event count display
- Confirmation and cancel buttons

### Category Usage Statistics

**Behavior:**
- Event count calculated by querying event_category_assignments table
- Count displayed inline with category name
- Updates reflected when:
  - Categories are created or deleted
  - Events are assigned or unassigned to categories
  - Categories are merged

**Display Format:**
- Inline with category name: "Music Festivals (23)"
- Counts loaded with category list data
- No loading states needed (counts loaded with categories)

## Reusable Components

### Existing Code to Leverage

**Backend:**
- `CategoryService.deleteCategory()` - Extend to support migration options
- `CategoryService.getCategoryEvents()` - Already returns event IDs for a category
- `EventCategoryAssignmentEntity` - Existing many-to-many relationship table
- Transaction handling pattern from existing `deleteCategory()` method

**Frontend:**
- `categories.vue` - Existing category list component (add checkboxes, event counts, merge button)
- `ModalLayout.vue` - Existing modal component for confirmation dialogs
- `CategoryService.deleteCategory()` - Update to support migration parameters
- Existing confirmation dialog pattern from current delete functionality

**Database:**
- `event_category_assignments` table - Many-to-many relationship already in place
- Sequelize transaction API - Already used in `deleteCategory()`

### New Components Required

**Backend:**
- `CategoryService.deleteCategoryWithMigration()` - New method supporting migration option
- `CategoryService.mergeCategories()` - New method for bulk category merging
- `CategoryService.getCategoryStats()` - New method to get event counts

**Frontend:**
- Enhanced delete confirmation dialog with migration options
- Merge categories dialog component
- Bulk selection UI state management
- Enhanced category service methods for new operations

## Technical Approach

### Backend API Changes

**Modify DELETE endpoint:**
```
DELETE /api/v1/calendars/:calendarId/categories/:categoryId?action=remove|migrate&targetCategoryId=:id
```
- Query parameter `action`: "remove" or "migrate"
- Query parameter `targetCategoryId`: required when action=migrate
- Validates target category exists and belongs to same calendar
- Returns affected event count in response

**New merge endpoint:**
```
POST /api/v1/calendars/:calendarId/categories/merge
Body: { targetCategoryId, sourceCategoryIds[] }
```
- Validates all categories exist and belong to calendar
- Validates target is not in source list
- Returns total affected event count

**Enhance GET categories endpoint:**
```
GET /api/v1/calendars/:calendarId/categories
```
- Add event count to each category in response
- Count calculated via JOIN query on event_category_assignments

### Frontend Component Updates

**categories.vue enhancements:**
- Add checkbox to each category item
- Track selected categories in component state
- Show/hide merge button based on selection count
- Display event count inline with category name
- Replace simple delete confirmation with enhanced migration dialog

**New dialog workflows:**
- Delete with migration: radio buttons, conditional dropdown, confirmation
- Merge categories: list with radio buttons, total count, confirmation

### Database Operations

All operations wrapped in transactions to ensure consistency:

**Delete with removal:**
1. Delete records from `event_category_assignments` WHERE category_id
2. Delete records from `event_category_content` WHERE category_id
3. Delete record from `event_categories` WHERE id

**Delete with migration:**
1. UPDATE `event_category_assignments` SET category_id = target WHERE category_id = source
2. Delete records from `event_category_content` WHERE category_id = source
3. Delete record from `event_categories` WHERE id = source

**Merge categories:**
1. For each source category:
   - UPDATE `event_category_assignments` SET category_id = target WHERE category_id = source
   - Delete from `event_category_content` WHERE category_id = source
   - Delete from `event_categories` WHERE id = source
2. Handle duplicate assignments (event already has target category)

**Count events:**
```sql
SELECT category_id, COUNT(*) as event_count
FROM event_category_assignments
WHERE category_id IN (list_of_ids)
GROUP BY category_id
```

## Out of Scope

The following features are explicitly excluded from this specification:

- Category reordering or custom sort order
- Category grouping or hierarchical nesting
- Category color or icon customization
- Advanced statistics (date ranges, event lists, trend analytics)
- Category templates or import/export
- Undo/redo functionality for category operations
- Category archiving (soft delete)
- Event preview lists in dialogs
- Notification system for category changes
- Audit log for category operations

## Success Criteria

1. **Category deletion with migration works reliably:**
   - User can choose between remove and migrate options
   - Migration dropdown shows all other categories
   - Events are correctly updated based on user choice
   - No data loss occurs during deletion

2. **Category merging functions correctly:**
   - Multiple categories can be selected via checkboxes
   - Merge dialog shows accurate event counts
   - All events are correctly reassigned to target category
   - Source categories are fully removed
   - No duplicate assignments are created

3. **Event counts are accurate and visible:**
   - Counts display inline with each category name
   - Counts update after deletion, merging, or category changes
   - Performance remains acceptable with large numbers of categories/events

4. **User experience is clear and safe:**
   - All operations require explicit confirmation
   - Dialogs show impact before execution (event counts)
   - Error messages are clear and actionable
   - UI responds appropriately during operations (loading states)

5. **Code quality maintained:**
   - All new backend methods have unit tests
   - Database operations use transactions appropriately
   - Frontend components follow existing patterns
   - Error handling covers edge cases (missing categories, permissions, etc.)

## Visual Design

No mockups provided. Implementation should follow existing UI patterns:

- Modal dialogs: Use existing `ModalLayout.vue` component
- Form controls: Use existing form styles and button classes
- Category list: Enhance existing `categories.vue` layout
- Checkboxes: Standard HTML checkboxes styled with existing CSS
- Inline counts: Display in parentheses after category name (e.g., "Category (23)")

## Dependencies

- Existing category management APIs in `CategoryService` and `CategoryRoutes`
- Existing category list UI in `categories.vue`
- Event-category assignment system (`event_category_assignments` table)
- Sequelize transaction support for database operations
- Existing modal dialog components (`ModalLayout.vue`)
- Existing error handling and exception classes

## Technical Notes

### Permission Checks
All operations must verify:
- User is logged in (`ExpressHelper.loggedInOnly`)
- User has modify permissions on the calendar (owner or editor)
- All categories belong to the specified calendar

### Error Handling
New operations should throw existing exceptions:
- `CategoryNotFoundError` - Category doesn't exist
- `CalendarNotFoundError` - Calendar doesn't exist
- `InsufficientCalendarPermissionsError` - User lacks permissions
- Add new exception if needed: `InvalidCategoryMergeError` (e.g., target in source list)

### Transaction Safety
All multi-step operations must use database transactions:
- Delete with migration: update assignments, delete content, delete category
- Merge: update all assignments, delete all source categories
- Rollback on any error to prevent partial updates

### Performance Considerations
- Event count queries should be optimized with proper indexes
- Existing indexes on `event_category_assignment_entity.ts` should be sufficient
- Consider bulk operations for merge (single UPDATE per source category)
- Avoid N+1 queries when loading categories with counts

### Multi-language Handling
- No translation merging occurs during merge operations
- Target category retains its existing translations unchanged
- Source category translations are deleted with the category
- Delete confirmation dialogs should show category name in user's current language
