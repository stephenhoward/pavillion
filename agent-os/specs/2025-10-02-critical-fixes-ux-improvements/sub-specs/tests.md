# Tests Specification

This is the tests coverage details for the spec detailed in @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/spec.md

> Created: 2025-10-02
> Version: 1.0.0

## Test Coverage

### Playwright E2E Tests (Regression Prevention)

**Critical Workflow: Category Management** (`tests/e2e/category-workflow.spec.ts`)
- Admin logs in successfully
- Navigates to calendar management → Categories tab
- Category list loads without 404 errors
- Clicks "Add Category" button
- Dialog opens without JavaScript errors
- Enters category name "Community Events"
- Clicks "Create Category" button
- Category appears in list immediately
- No console errors during entire workflow

**Critical Workflow: Event Category Assignment** (`tests/e2e/event-categories.spec.ts`)
- Admin creates calendar
- Admin creates category "Workshops"
- Admin creates new event "Tech Workshop"
- Event creation dialog shows category selector
- Category selector loads categories without errors
- Admin selects "Workshops" category
- Admin saves event
- Event displays with category badge
- Admin filters events by "Workshops" category
- Only "Tech Workshop" appears in filtered list

**Critical Workflow: Admin Account Management** (`tests/e2e/admin-accounts.spec.ts`)
- Admin logs in
- Navigates to Admin → Accounts
- Account list loads without 404 errors
- Admin sees own account in list (not "No accounts")
- Admin navigates to Applications tab
- Application list loads (may be empty)
- Admin navigates to Invitations tab
- Invitations component mounts without errors
- Admin clicks "Send Invitation"
- Invitation dialog opens
- Admin enters email and sends invitation
- Invitation appears in list

**Critical Workflow: Admin Application Approval** (`tests/e2e/admin-applications.spec.ts`)
- Create test application via API
- Admin views application in Applications tab
- Admin clicks "Approve" on application
- Approval confirmation dialog appears
- Admin confirms approval
- Application removed from list
- New account appears in Accounts tab
- Welcome email sent (verify API call)

**UX Improvement: Calendar Name Validation** (`tests/e2e/calendar-validation.spec.ts`)
- User attempts to create calendar with hyphens: "test-calendar"
- Error message appears: "Use underscores instead of hyphens"
- Placeholder shows "your_calendar_name" (not hyphens)
- User creates calendar with underscores: "test_calendar"
- Calendar created successfully
- No validation errors

**UX Improvement: Event Date Display** (`tests/e2e/event-display.spec.ts`)
- Create event with specific date/time
- Navigate to calendar event list
- Event card displays date/time clearly
- Date format is user-friendly (not ISO format)
- Recurring events show recurrence indicator
- All events show dates (none missing)

### Unit Tests

**CategoryService** (`src/server/calendar/service/category.ts`)
- `createCategory()` - Creates category with multilingual content
- `getCalendarCategories()` - Retrieves all categories for calendar
- `updateCategory()` - Updates category content
- `deleteCategory()` - Deletes category (fails if assigned to events)
- `assignCategoriesToEvent()` - Assigns multiple categories to event
- `removeeCategoryFromEvent()` - Removes single category from event
- `getEventCategories()` - Gets all categories for event

**AccountService** (`src/server/accounts/service/account.ts`)
- `listAccounts()` - Returns paginated account list
- `filterAccountsByStatus()` - Filters by active/suspended/pending
- `searchAccounts()` - Searches by email/name
- `getAccountById()` - Retrieves single account details
- `updateAccountStatus()` - Changes account status
- `approveApplication()` - Converts application to account
- `denyApplication()` - Rejects application
- `sendInvitation()` - Creates and sends invitation

**PublicService** (`src/server/public/service/public.ts`)
- `getPublicCalendar()` - Retrieves calendar by urlName (public only)
- `getPublicEvents()` - Gets events with filtering
- `filterEventsByCategories()` - Filters by multiple categories
- `filterEventsByDateRange()` - Filters by date range
- `searchEvents()` - Full-text search in events
- `getPublicCategories()` - Gets calendar categories for public

**Vue Component Tests**

**manageCalendar.vue**
- Category dialog opens without errors
- Category creation form validation works
- Focus management works correctly (no .value on DOM methods)
- Categories list displays properly
- Error states handled gracefully

**calendar.vue**
- Placeholder shows underscores not hyphens
- Validation error message is clear
- Help text mentions underscores
- Valid names accepted
- Invalid names rejected with helpful message

**eventCard.vue**
- Date displays on event card
- Date format is user-friendly
- Recurring events show recurrence indicator
- Timezone handled correctly

**searchFilter.vue**
- currentLanguage injection works
- No console warnings
- Multilingual filtering works
- Language switching updates filters

### Integration Tests

**Category Management Workflow**
- Admin creates calendar
- Admin creates category with English name
- Admin adds Spanish translation to category
- Category appears in list
- Admin assigns category to event
- Event shows category assignment
- Public user filters events by category
- Only events with that category shown

**Admin Account Management Workflow**
- Admin logs in
- Admin navigates to Accounts page
- Account list loads successfully (no 404)
- Admin sees own account in list
- Admin can filter by status
- Admin can search by email
- Admin can view pending applications
- Admin approves application
- New account created and email sent
- Admin sends invitation
- Invitation appears in list


### API Integration Tests

**Category API Endpoints** (`src/server/calendar/api/v1/calendar-routes.test.ts`)
- GET `/api/v1/calendars/:id/categories` returns 200 with categories
- GET with invalid calendar returns 404
- GET without auth returns 401
- POST creates category with valid data
- POST returns 201 with created category
- POST without auth returns 401
- POST without ownership returns 403
- PUT updates category content
- DELETE removes category
- DELETE fails if category assigned to events (409)

**Event Category Assignment API** (`src/server/calendar/api/v1/event-routes.test.ts`)
- GET `/api/v1/events/:id/categories` returns assigned categories
- POST assigns multiple categories to event
- POST replaces existing assignments
- DELETE removes single category from event
- All endpoints enforce proper authorization

**Admin Account API** (`src/server/accounts/api/v1/admin-routes.test.ts`)
- GET `/api/v1/admin/accounts` returns account list
- GET returns 403 for non-admin
- GET supports pagination
- GET supports filtering by status
- GET supports search
- POST `/api/v1/admin/applications/:id/approve` creates account
- POST sends welcome email
- POST `/api/v1/admin/applications/:id/deny` removes application
- POST `/api/v1/admin/invitations` creates invitation
- POST sends invitation email


### Frontend Component Tests

**Category Dialog Component**
- Opens without JavaScript errors
- Input field focuses correctly
- Create button enables when name entered
- API call made on submit
- Success refreshes category list
- Error displays helpful message
- Multilingual input fields work

**Admin Accounts Component**
- Loads account list on mount
- Displays accounts in table
- Pagination controls work
- Filter dropdown functions
- Search input filters results
- Click account opens details
- No 404 errors in console

### Playwright Test Configuration

**Test Environment Setup:**
- Use development database (resets between test runs)
- Seed test admin account before tests
- Clear database state between test suites
- Run tests in headless mode for CI
- Capture screenshots on failure
- Record video of failed tests

**Fixtures:**
- `authenticatedAdmin` - Logs in as admin user
- `cleanDatabase` - Resets database to seed state
- `testCalendar` - Creates test calendar for use in tests
- `testCategory` - Creates test category for use in tests
- `testEvent` - Creates test event for use in tests

**Assertions:**
- No 404 network errors during test execution
- No JavaScript console errors (except expected validation)
- No Vue warnings in console
- All API calls complete successfully
- UI elements render without layout issues

**Coverage Targets:**
- All workflows from QA report must have E2E tests
- All blocking issues must have regression tests
- All high-priority UX issues must have validation tests

### Mocking Requirements

**Email Service**
- Mock Nodemailer for invitation/welcome emails
- Verify email sent with correct content
- Verify email sent to correct recipient
- Don't actually send emails in tests

**Authentication/Authorization**
- Mock JWT authentication for API tests
- Mock admin role for admin endpoint tests
- Mock calendar ownership for category tests
- Mock public access (no auth) for public endpoint tests

**Database**
- Use SQLite in-memory database for tests
- Seed test data before each test suite
- Clean up after each test
- Isolate test data between tests

**Time-Based Tests**
- Mock Luxon/Date for date filtering tests
- Ensure consistent dates across tests
- Test timezone handling
- Test date range edge cases
