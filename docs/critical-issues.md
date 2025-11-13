# Critical Issues Found in Pavillion

> QA Testing Session: 2025-10-02
> Environment: localhost:3000
> Test Account: admin@pavillion.dev

## 🔴 Blocking Issues

### 1. Category API Endpoints Missing (404 Errors)

**Severity:** High
**Impact:** Prevents users from managing event categories
**Status:** Broken

**Description:**
Multiple API endpoints for category management return 404 errors throughout the application:
- `/api/v1/calendars/{calendarId}/categories` - Returns 404
- Category loading fails in event creation dialog
- Category loading fails in event editing dialog
- Category management page shows "Failed to load categories"

**User Impact:**
- Cannot create event categories
- Cannot assign categories to events
- Category filtering appears in UI but is non-functional
- "Add Category" button triggers JavaScript error: `TypeError: categoryNameInput.value.focus is not a function`

**Steps to Reproduce:**
1. Create a calendar
2. Navigate to "Manage Calendar" → "Categories" tab
3. Observe "Failed to load categories" error message
4. Click "Add Category" button
5. Enter category name "Community Events"
6. Click "Create Category"
7. Dialog closes but category list still shows "Failed to load categories"

**Console Errors:**
```
Error loading calendar categories: AxiosError
Failed to load resource: the server responded with a status of 404 (Not Found)
TypeError: categoryNameInput.value.focus is not a function
```

### 2. Admin Account Management Broken

**Severity:** High
**Impact:** Administrators cannot view or manage user accounts
**Status:** Broken

**Description:**
The admin accounts interface fails to load account data with 404 errors and shows placeholder message "There are no accounts on this server yet" even though the admin account clearly exists.

**Console Errors:**
```
Error loading accounts: AxiosError
Failed to load resource: the server responded with a status of 404 (Not Found)
[Vue warn]: Unhandled error during execution of beforeMount hook at <Invitations>
```

**Steps to Reproduce:**
1. Login as admin
2. Navigate to Settings → Admin Settings → Accounts
3. Observe "No accounts" message despite being logged in as admin
4. Check browser console for 404 errors

**User Impact:**
- Cannot view list of user accounts
- Cannot manage user permissions
- Cannot process account applications
- Cannot send invitations

### 3. Public Calendar Routes Not Configured

**Severity:** High
**Impact:** Public users cannot view calendars
**Status:** Broken

**Description:**
Public calendar viewing URLs return 404 and Vue Router warnings. Tested multiple URL patterns:
- `/test_calendar` - No match found
- `/site/test_calendar` - No match found
- Only authenticated route works: `/calendar/test_calendar`

**Console Errors:**
```
[Vue Router warn]: No match found for location with path "/test_calendar"
[Vue Router warn]: No match found for location with path "/site/test_calendar"
```

**User Impact:**
- Anonymous users cannot view public calendars
- Calendar federation likely broken as external instances cannot access calendar data
- Core mission of "anonymous public access" is not functional

**Expected Behavior:**
Based on the product mission (privacy-first with anonymous public access), there should be public routes that allow unauthenticated viewing of calendar content.

## ⚠️ Usability Issues

### 4. Calendar Name Format Validation Mismatch

**Severity:** Medium
**Impact:** Confusing user experience during calendar creation
**Status:** Inconsistent UX

**Description:**
The calendar creation form accepts hyphens in the input field (placeholder shows "your-calendar-name") but rejects them with error "Invalid calendar name format". Only underscores are accepted.

**Error Message:**
```
Invalid calendar name format
```

**UI Guidance:**
"Calendar names must be 3-24 characters long, start with a letter or number, and can only contain letters, numbers, and underscores"

**User Impact:**
- Users naturally try hyphens first (common URL convention)
- Error message appears but doesn't clearly explain what's wrong
- Trial-and-error required to discover underscores work

**Recommendation:**
- Update placeholder text to show `your_calendar_name` instead of `your-calendar-name`
- Improve error message to specifically state "Hyphens are not allowed, use underscores instead"
- Or better: accept hyphens in calendar names if technically feasible

### 5. Missing Translation Keys in Admin Interface

**Severity:** Low
**Impact:** Unprofessional appearance in admin interface
**Status:** Incomplete i18n

**Description:**
Admin navigation shows raw translation keys instead of translated text:
- "menu.navigation.skip_to_content" instead of "Skip to main content"

**Console Warnings:**
```
i18next::translator: missingKey en-US admin menu.navigation.skip_to_content
```

**User Impact:**
- Admin interface appears unfinished
- Accessibility feature (skip to content link) is visible but shows debug text

### 6. Search Filter Component Warning

**Severity:** Low
**Impact:** Developer console noise, potential functionality issue
**Status:** Component implementation error

**Description:**
Vue warns about missing injection for "currentLanguage" in SearchFilter component.

**Console Warning:**
```
[Vue warn]: injection "currentLanguage" not found at <SearchFilter>
```

**Potential Impact:**
- Search/filter functionality may not properly handle multilingual content
- Could cause issues when switching languages

## 📊 Workflow Status Summary

| Workflow | Status | Completeness |
|----------|--------|--------------|
| Login/Authentication | ✅ Working | 100% |
| Calendar Creation | ⚠️ Partial | 70% (name validation issues) |
| Event Creation | ⚠️ Partial | 80% (works without categories) |
| Event Editing | ⚠️ Partial | 80% (works without categories) |
| Event Categories | 🔴 Broken | 0% (API endpoints missing) |
| Calendar Management | ⚠️ Partial | 50% (editors work, categories broken) |
| Admin - Accounts | 🔴 Broken | 0% (cannot load account list) |
| Admin - Settings | ✅ Working | 90% (minor i18n issues) |
| Feed (Federation) | ✅ Working | 100% (empty state shown correctly) |
| Inbox (Notifications) | ✅ Working | 100% (empty state shown correctly) |
| Public Calendar Access | 🔴 Broken | 0% (routes not configured) |

## 🎯 Priority Recommendations

### Must Fix Before Launch
1. **Implement category API endpoints** - Core feature completely non-functional
2. **Fix admin account management API** - Essential for instance administration
3. **Configure public calendar routes** - Core mission requirement (anonymous access)

### Should Fix Soon
4. Fix calendar name validation UX (hyphen/underscore confusion)
5. Implement missing translation keys in admin interface
6. Fix SearchFilter currentLanguage injection

### Code Quality
7. Resolve JavaScript focus() error in category dialog
8. Handle Vue warn for extraneous event listeners properly

## 📝 Testing Notes

**Successful Workflows:**
- User login with email/password
- Calendar creation (with underscores in name)
- Event creation with basic details (name, description, location, date)
- Event viewing in calendar list
- Event editing dialog opens and saves
- Calendar editor invitation interface (UI only, no actual invitations tested)
- Settings page navigation
- Admin settings page (general settings)

**Untested Workflows:**
- Password reset flow
- Event duplication functionality
- Actual calendar editor invitations with real second user
- Federation (following/followers)
- Event category filtering
- Public calendar embedding
- Media upload functionality (interface present but not tested)

## 🔧 Technical Context

The application appears to be under active development with some features having complete frontend implementations but missing backend API endpoints. The category management feature is particularly affected, suggesting either:
1. Backend API routes are not yet implemented
2. API routes are misconfigured or using wrong paths
3. Authentication/authorization preventing API access

The admin interface issues suggest similar backend incompleteness, where the UI exists but the supporting APIs are not responding correctly.
