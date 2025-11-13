# Technical Specification

This is the technical specification for the spec detailed in @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/spec.md

> Created: 2025-10-02
> Version: 1.0.0

## Technical Requirements

### 1. Category API Endpoints

**Issue:** API endpoints return 404, preventing all category operations

**Implementation Location:** `src/server/calendar/api/v1/calendar-routes.ts`

**Requirements:**
- Implement GET `/api/v1/calendars/:calendarId/categories` - List all categories for a calendar
- Implement POST `/api/v1/calendars/:calendarId/categories` - Create new category
- Implement PUT `/api/v1/calendars/:calendarId/categories/:categoryId` - Update category
- Implement DELETE `/api/v1/calendars/:calendarId/categories/:categoryId` - Delete category
- Implement POST `/api/v1/events/:eventId/categories` - Assign categories to event
- Implement DELETE `/api/v1/events/:eventId/categories/:categoryId` - Remove category from event
- Ensure event API endpoints include categories array when returning event data

**Service Layer:** `src/server/calendar/service/category.ts`
- Already exists with business logic
- Wire up to API routes
- Ensure proper authentication/authorization checks
- Handle multilingual content properly

**Frontend Fix:** `src/client/components/manageCalendar.vue`
- Fix JavaScript error: `TypeError: categoryNameInput.value.focus is not a function`
- Change `categoryNameInput.value.focus()` to `categoryNameInput.focus()` (remove `.value`)
- Element refs in Vue 3 don't need `.value` for DOM methods

### 2. Admin Account Management API

**Issue:** Account listing endpoint returns 404, admin cannot view users

**Implementation Location:** `src/server/accounts/api/v1/account-routes.ts`

**Requirements:**
- Implement GET `/api/v1/admin/accounts` - List all user accounts with pagination
- Implement GET `/api/v1/admin/accounts/:accountId` - Get account details
- Implement PUT `/api/v1/admin/accounts/:accountId/status` - Approve/suspend accounts
- Implement GET `/api/v1/admin/applications` - List pending applications
- Implement POST `/api/v1/admin/applications/:id/approve` - Approve application
- Implement POST `/api/v1/admin/applications/:id/deny` - Deny application
- Implement GET `/api/v1/admin/invitations` - List sent invitations
- Implement POST `/api/v1/admin/invitations` - Send new invitation
- Implement DELETE `/api/v1/admin/invitations/:id` - Cancel invitation

**Service Layer:** `src/server/accounts/service/account.ts`
- Implement admin-specific methods for account listing
- Filter by status (active, suspended, pending)
- Support pagination for large user lists
- Ensure only admin users can access these endpoints

**Authorization:**
- Add admin role check middleware: `requireAdmin`
- Verify user has admin role before allowing access
- Return 403 Forbidden for non-admin users

### 3. Calendar Name Validation UX

**Issue:** Placeholder shows hyphens, validation rejects hyphens

**Implementation Locations:**
- `src/client/components/calendar.vue` - Update placeholder
- `src/client/locales/en-US/client.json` - Update help text

**Changes:**
- Change placeholder from `your-calendar-name` to `your_calendar_name`
- Update error message to explicitly mention: "Hyphens are not allowed. Use underscores instead."
- Make validation message more specific: "Calendar names must use underscores (_), not hyphens (-)"

### 4. Missing Translation Keys

**Issue:** Raw i18n keys displayed in admin interface

**Implementation Location:** Translation files

**Requirements:**
- Add to `src/client/locales/en-US/admin.json`:
  ```json
  {
    "menu": {
      "navigation": {
        "skip_to_content": "Skip to main content"
      }
    }
  }
  ```

### 5. Event Date Display

**Issue:** Event cards don't show when events occur

**Implementation Location:** `src/client/components/eventCard.vue` or equivalent

**Requirements:**
- Add date/time display to event cards
- Format: "October 15, 2025 at 6:00 PM" (use Luxon for formatting)
- Handle recurring events: Show "Repeats weekly" or similar indicator
- Handle timezone properly

### 6. SearchFilter Component Warning

**Issue:** Missing "currentLanguage" injection

**Implementation Location:** `src/client/components/searchFilter.vue`

**Requirements:**
- Either inject currentLanguage from parent: `const currentLanguage = inject('currentLanguage')`
- Or use i18next directly: `const { i18n } = useTranslation()`
- Ensure component can access current language for multilingual filtering

## Approach Options

### Option A: Fix Issues Incrementally (Selected)

**Approach:**
- Fix each blocking issue separately
- Test after each fix
- Deploy incrementally

**Pros:**
- Lower risk - can roll back individual fixes
- Easier to test - isolated changes
- Faster to production for critical fixes
- Clearer git history

**Cons:**
- More commits required
- Slightly longer total implementation time

**Rationale:** Given the critical nature of these issues affecting core workflows, incremental fixes allow faster deployment of category API endpoints while work continues on admin and public routes. Each fix is independently valuable.

### Option B: Fix All Issues Together

**Approach:**
- Implement all fixes in single large PR
- Test everything together
- Deploy as package

**Pros:**
- Single deployment
- Comprehensive testing
- One PR to review

**Cons:**
- Higher risk - all or nothing
- Harder to isolate issues if problems arise
- Longer time to production
- Large PR harder to review

## External Dependencies

No new external dependencies required. All fixes use existing:
- Express.js for API routes
- Sequelize for database operations
- Vue 3 for frontend
- i18next for translations
- Luxon for date formatting
