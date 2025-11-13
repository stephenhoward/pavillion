# Specification: Event Search Functionality

## Goal

Enable users to quickly find specific events in large calendars (100+ events) by implementing real-time text search that filters events by title and description.

## User Stories

### Story 1: Search for Specific Event
As a calendar owner managing 100+ events, I want to type keywords into a search field so that I can quickly find specific events without manually scrolling through the entire list.

**Workflow:**
- User opens their calendar with many events
- User types search terms into the existing search field above the event list
- Event list updates in real-time (with debouncing) to show only matching events
- User can see all events that contain their search terms in title or description
- User can clear the search to return to the full event list

### Story 2: Bookmark Search Results
As a calendar owner, I want my search query to be reflected in the URL so that I can bookmark specific searches or share filtered views with collaborators.

**Workflow:**
- User performs a search
- URL updates to include search parameter (e.g., `?search=workshop`)
- User bookmarks the URL or shares it
- When URL is revisited, search is automatically applied
- Event list shows filtered results based on URL parameters

### Story 3: Combine Search with Category Filters
As a calendar owner, I want to use search alongside existing category filters so that I can find specific events within a category.

**Workflow:**
- User selects one or more categories
- User enters search terms
- Event list shows only events that match both the category selection AND search terms
- User can clear either filter independently
- User can clear all filters at once

## Core Requirements

### Search Functionality
- Search across event titles and descriptions (event_content table)
- Case-insensitive matching using PostgreSQL ILIKE
- Real-time filtering with 300ms debounce (already implemented in SearchFilter.vue)
- No fuzzy matching or advanced search operators (keep simple for MVP)
- No text highlighting in results (show regular event list)

### User Interface
- Utilize existing SearchFilter component above event list
- Search input already has clear button (✕) when query is present
- Works alongside existing category filter
- "Clear All Filters" button clears both search and categories
- Maintain existing bulk operations compatibility

### URL Parameter Management
- Add/update `?search=query` parameter in URL when search changes
- Read search parameter from URL on component mount
- Use Vue Router for URL parameter management
- Preserve existing category parameter handling (`?categories=id1,id2`)
- Support combined parameters (`?search=workshop&categories=abc123`)

### Backend API Support
- Backend already supports search parameter (lines 43-51 in events.ts API)
- Backend already implements search logic (lines 69-85 in events.ts service)
- Uses Sequelize Op.iLike for case-insensitive search
- Searches both name and description fields in event_content table

## Visual Design

No mockups provided. Feature integrates with existing UI:
- Stubbed search input field in SearchFilter.vue (lines 8-26)
- Category filter below search (lines 29-60)
- Clear filters section at bottom (lines 64-68)
- Existing SCSS mixins for styling (lines 222-280)

**Key UI Elements:**
- Search input with placeholder text (i18n: 'search_placeholder')
- Clear button (✕) appears when query is not empty
- Category checkboxes maintain current styling
- Clear all filters button shows when any filter is active

**Responsive Considerations:**
- Follow existing component responsive patterns
- Use established SCSS mixins from mixins.scss

## Reusable Components

### Existing Frontend Code
**Component:** SearchFilter.vue
- Location: `/src/client/components/logged_in/calendar/SearchFilter.vue`
- Already implements: Search input, debouncing (300ms), clear button, category filtering
- Emit: `filtersChanged` event with `{ search, categories }` structure
- Status: Stubbed and ready - search functionality just needs wire-up

**Component:** calendar.vue
- Location: `/src/client/components/logged_in/calendar/calendar.vue`
- Already implements: Filter handling (lines 52-79), SearchFilter integration
- Method: `handleFiltersChanged(filters)` - passes filters to EventService
- Status: Fully functional - just needs URL parameter sync

**Service:** EventService
- Location: `/src/client/service/event.ts`
- Method: `loadCalendarEvents(calendarId, filters)`
- Status: Needs investigation - verify it passes filters to API

### Existing Backend Code
**API Handler:** EventRoutes.listEvents()
- Location: `/src/server/calendar/api/v1/events.ts` (lines 25-66)
- Already parses: `req.query.search` and `req.query.categories`
- Status: Fully implemented and functional

**Service:** EventService.listEvents()
- Location: `/src/server/calendar/service/events.ts` (lines 46-100)
- Already implements: Search with Op.iLike on name and description
- Status: Fully implemented and functional

### Database Structure
**Table:** event_content
- Columns: id, event_id, language, name, description
- Indexes: Already has indexes on name and description (lines 107, 111)
- Status: Optimized for search queries

### New Code Required
**URL Parameter Sync in calendar.vue:**
- Watch currentFilters and update Vue Router query params
- Read query params on mount and pass to SearchFilter as initialFilters
- Reason: No existing URL parameter persistence for search

## Technical Approach

### Frontend Implementation
**File:** `/src/client/components/logged_in/calendar/calendar.vue`

1. **Add URL parameter sync on mount:**
   - Read `route.query.search` and `route.query.categories`
   - Pass to SearchFilter as `initialFilters` prop (already supports this)

2. **Watch filter changes and update URL:**
   - Watch `currentFilters` reactive object
   - Use `router.replace()` to update query params without page reload
   - Preserve existing query params while updating search/categories

3. **Verify EventService integration:**
   - Confirm `loadCalendarEvents()` passes filters to backend API
   - Should already work based on `handleFiltersChanged()` implementation

### Backend Implementation
**Status:** No changes needed - already fully implemented

The backend search functionality is complete:
- API endpoint parses search parameter (line 49-51 in events.ts)
- Service layer implements case-insensitive search (lines 69-85 in events.ts)
- Database has proper indexes on searchable fields
- Query uses Sequelize Op.iLike for PostgreSQL ILIKE operator

### Translation Keys Required
Check if these keys exist in `/src/client/locale/en/calendars.json`:
- `search_filter.search_events` - Label for search input
- `search_filter.search_placeholder` - Placeholder text
- `search_filter.clear_all_filters` - Clear filters button

If missing, add them to translations.

### Performance Considerations
- Debouncing (300ms) prevents excessive API calls - already implemented
- Database indexes on name and description ensure fast queries
- No client-side filtering needed - all filtering done server-side
- URL updates use `router.replace()` to avoid history pollution

## Out of Scope

### Explicitly Excluded (Deferred to Future Specs)
- Category Management Enhancements
- Calendar Organization Tools
- Advanced Location Management features
- Event Import/Export functionality
- Fuzzy matching or "did you mean?" suggestions
- Search result highlighting (bold matching text)
- Search history or saved searches
- Advanced search operators (AND, OR, NOT)
- Search autocomplete or suggestions

### Not Included in This Spec
- Public-facing search (focus is authenticated users only)
- Federation/multi-user search features
- Search across multiple calendars simultaneously
- Full-text search with ranking/relevance
- Search performance metrics or analytics

## Success Criteria

### Functional Completeness
- User can type search query and see filtered event list in real-time
- Search is case-insensitive and searches both title and description
- Search works alongside category filtering (both filters apply)
- Clear search button empties search and shows all events
- Clear all filters button clears both search and categories

### URL Parameter Persistence
- Search query appears in URL as `?search=query` parameter
- Bookmarking URL and revisiting applies the search automatically
- URL parameters update without page reload
- Multiple filters combine in URL (`?search=term&categories=id`)

### Performance
- Search debouncing prevents API calls on every keystroke (300ms delay)
- Database queries use existing indexes for fast lookups
- No perceivable lag when typing or clearing search
- Event list updates smoothly without flashing or jumping

### User Experience
- Search behavior is intuitive and predictable
- Clear visual feedback when search is active
- Easy to clear search and return to full list
- Maintains existing bulk operations functionality
- Works seamlessly with existing category filter

### Technical Quality
- All existing tests continue to pass
- New tests added for URL parameter handling
- Code follows Pavillion's established patterns
- No new external dependencies introduced
- Proper error handling if API calls fail
