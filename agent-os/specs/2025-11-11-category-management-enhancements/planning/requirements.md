# Category Management Enhancements - Requirements

> Spec: Category Management Enhancements
> Created: 2025-11-11
> Status: Requirements Gathering

## Overview

Advanced category organization tools to help calendar owners manage their event categories more effectively. This includes category deletion with migration options, category merging, and usage statistics.

## Current System Analysis

**Existing Implementation:**
- Categories are scoped to individual calendars
- Categories have multilingual content support (names/descriptions)
- Many-to-many relationship between categories and events via `event_category_assignments` table
- Current `deleteCategory()` method removes categories and all event assignments
- Existing category listing/management page available
- Existing category management APIs in place

## Feature Requirements

### 1. Category Deletion with Migration Options

**Behavior:**
When a user deletes a category, they must choose between two options:

**Option A: Remove Category Assignments**
- Keep all events that have this category
- Remove the category assignment from these events
- Events remain unchanged otherwise

**Option B: Migrate to Another Category**
- Keep all events that have this category
- Move the category assignment to a different selected category
- Remove the original category after migration

**Confirmation Dialog:**
- Show how many events will be affected
- Display the chosen option clearly
- Require explicit confirmation before executing

**Example:**
```
Delete Category: "Music Festivals"
This category is assigned to 23 events.

Choose an action:
○ Remove category from these 23 events
○ Migrate these 23 events to: [Category Selector]

[Cancel] [Confirm Delete]
```

### 2. Category Merging

**Selection Workflow:**
1. User selects multiple categories from the category list (2 or more)
2. User initiates merge action
3. Dialog appears to choose which category becomes the target

**Target Selection Dialog:**
- Show all selected categories
- Default selection: first category selected by user
- User can change which category is the target before confirming
- Show event count for each category being merged

**Merge Behavior:**
- All event assignments from source categories move to target category
- Target category's names/translations are preserved (no translation merging)
- Source categories are deleted after assignments are transferred
- Events keep all other properties unchanged

**Confirmation Dialog:**
- Show target category name
- Show source categories being merged (with event counts)
- Show total number of events affected
- Require explicit confirmation

**Example:**
```
Merge Categories

Select which category to keep:
● Music Festivals (23 events) [Target]
○ Live Music (15 events)
○ Concerts (31 events)

Result: 69 events will be assigned to "Music Festivals"
The other categories will be deleted.

[Cancel] [Confirm Merge]
```

### 3. Category Usage Statistics

**Display:**
- Show event count for each category
- Display inline in existing category list
- Format: Simple number next to category name
- No additional complexity needed (no date ranges, no event previews)

**Example Display:**
```
Category List:
- Music Festivals (23)
- Sports Events (45)
- Community Meetings (12)
- Workshops (8)
```

### 4. UI Integration

**Location:**
- Add features to existing category listing/management screen for a calendar
- Integrate with existing category management interface
- Use existing UI patterns and components where possible

**Actions Available:**
- Bulk selection for category merging
- Delete button/action for individual categories
- Event count display inline with category names

### 5. Multi-language Considerations

**Translation Handling:**
- No merging of translations between categories
- Target category keeps its own translations unchanged
- Source categories' translations are discarded during merge
- Only event assignments are transferred

### 6. Out of Scope

The following features are explicitly excluded from this implementation:
- Category reordering
- Category grouping/nesting
- Category color customization
- Category icon customization
- Advanced statistics (date ranges, event lists, analytics)
- Category templates
- Category import/export

## Technical Requirements

### Backend API

**New Endpoints Needed:**
1. `DELETE /api/v1/calendars/:urlName/categories/:categoryId`
   - Query parameter: `action` (remove|migrate)
   - Query parameter: `targetCategoryId` (required if action=migrate)
   - Response: Success/failure with affected event count

2. `POST /api/v1/calendars/:urlName/categories/merge`
   - Body: `{ targetCategoryId, sourceCategoryIds[] }`
   - Response: Success/failure with affected event count

3. `GET /api/v1/calendars/:urlName/categories/:categoryId/stats`
   - Response: `{ eventCount }`

**Validation:**
- Prevent deletion of non-existent categories
- Prevent migration to non-existent target categories
- Prevent merging with invalid target selection
- Ensure all categories belong to the specified calendar

### Frontend Components

**Enhancements Needed:**
1. Category list component updates:
   - Add event count display
   - Add bulk selection UI
   - Add merge action button
   - Add delete confirmation dialog
   - Add merge target selection dialog

2. API service methods:
   - `deleteCategory(calendarUrlName, categoryId, action, targetCategoryId?)`
   - `mergeCategories(calendarUrlName, targetCategoryId, sourceCategoryIds)`
   - `getCategoryStats(calendarUrlName, categoryId)`

### Database Operations

**Required Operations:**
1. Count events for a category
2. Remove category assignments for events
3. Transfer category assignments to different category
4. Delete categories and their content translations
5. Bulk transfer of assignments during merge

## User Stories

### Story 1: Delete Unused Category
As a calendar owner, I want to delete a category that I no longer need, so that my category list stays organized and relevant.

**Acceptance Criteria:**
- I can delete a category from the category management screen
- I see how many events will be affected before confirming
- I can choose to keep events without the category or migrate them
- The category is removed after I confirm

### Story 2: Merge Duplicate Categories
As a calendar owner, I want to merge multiple similar categories into one, so that my events are better organized and I avoid duplicate categorization.

**Acceptance Criteria:**
- I can select multiple categories to merge
- I can choose which category to keep as the target
- I see the total event count that will be affected
- After merging, all events are assigned to the target category
- The source categories are deleted

### Story 3: View Category Usage
As a calendar owner, I want to see how many events are in each category, so that I can understand which categories are most used and make informed decisions about category management.

**Acceptance Criteria:**
- Event counts appear next to each category name
- Counts update when events are added/removed
- Counts are visible without additional clicks or navigation

## Success Criteria

1. Calendar owners can delete categories with clear options for handling events
2. Calendar owners can merge multiple categories into one target category
3. Event counts are visible for all categories in the management interface
4. All operations require confirmation with impact summaries
5. No data loss occurs during deletion or merging operations
6. UI integrates seamlessly with existing category management interface

## Dependencies

- Existing category management APIs and service layer
- Existing category listing/management UI component
- Event-category assignment system
- Confirmation dialog components (or create new ones)

## Implementation Notes

- Locate new API methods alongside existing category management APIs
- Use existing UI patterns and components where possible
- Follow existing code style and patterns in the codebase
- Ensure proper error handling and user feedback
- Add comprehensive tests for all new operations
