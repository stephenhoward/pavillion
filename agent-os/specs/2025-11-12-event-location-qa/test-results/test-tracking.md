# Event Location QA Test Tracking Document

> Test Date: 2025-11-12
> Tester: Claude (AI QA Agent)
> Environment: Development (localhost:3000)
> Calendar: test_calendar@pavillion.dev
> Login: admin@pavillion.dev

## Test Environment Setup

**Development Server Status:**
- Frontend: ✓ Running on port 3000
- Backend: ✓ Running on port 3001
- Database: ✓ Accessible
- Playwright MCP: ✓ Connected

**Test Calendar Information:**
- Calendar: test_calendar@pavillion.dev
- Calendar ID: (To be determined from database)
- Existing Events: 10 events visible

## Database Connection

Using SQLite database for development environment.
Database queries will be executed via Bash commands.

## Test Data Tracking

### Created Locations

| Location ID | Name | Address | City | State | Postal | Country | Calendar ID | Created By Scenario |
|------------|------|---------|------|-------|--------|---------|-------------|-------------------|
| | | | | | | | | |

### Created Events

| Event ID | Event Name | Location ID | Scenario | Notes |
|----------|------------|-------------|----------|-------|
| | | | | |

## Test Execution Log

### Group 1: Environment Setup ✓

- [✓] 1.1 Development server verified running
- [✓] 1.2 Playwright MCP connection established
- [✓] 1.3 Database queries prepared
- [✓] 1.4 Test tracking document created

### Group 2: Location CRUD Operations (Scenarios 1-5, 8)

#### Scenario 1: Create Event with New Location
- Status: Not Started
- Expected: Location created with URL-based ID
- Actual:
- Database Verification:
- Notes:

#### Scenario 2: Reuse Existing Location (Exact Match)
- Status: Not Started
- Expected: Same location_id reused
- Actual:
- Database Verification:
- Notes:

#### Scenario 3: Similar But Not Exact Location
- Status: Not Started
- Expected: New location created
- Actual:
- Database Verification:
- Notes:

#### Scenario 4: Edit Event Location
- Status: Not Started
- Expected: New location created, old unchanged
- Actual:
- Database Verification:
- Notes:

#### Scenario 5: Delete Event - Location Persists
- Status: Not Started
- Expected: Location persists after event deletion
- Actual:
- Database Verification:
- Notes:

#### Scenario 8: Multiple Events Same Location
- Status: Not Started
- Expected: All events share same location_id
- Actual:
- Database Verification:
- Notes:

### Group 3: Edge Cases and Partial Data (Scenarios 6-7, 10)

#### Scenario 6: Partial Location Data - Valid Cases
- Status: Not Started
- Test Case 1 (Name only):
- Test Case 2 (City/State only):
- Database Verification:
- Notes:

#### Scenario 7: Invalid Hierarchy - Missing Validation (BUG)
- Status: Not Started
- Expected Bug: Event saves without validation error
- Actual:
- Database Verification:
- Notes:

#### Scenario 10: Cross-Calendar Location Isolation
- Status: Not Started
- Expected: Separate locations per calendar
- Actual:
- Database Verification:
- Notes:

### Group 4: Critical Bug Verification (Scenario 9)

#### Scenario 9: Country Field Data Loss Bug
- Status: Not Started
- Before Edit (Country saved):
- After Edit (Country lost):
- UI Verification (Missing field):
- Code Analysis (toObject() bug):
- Bug Confirmed:

### Group 5: Missing Features Documentation

#### Missing Feature 1: Country Field Data Loss
- Status: Not Documented

#### Missing Feature 2: Hierarchy Validation
- Status: Not Documented

#### Missing Feature 3: Location Browsing/Autocomplete
- Status: Not Documented

#### Missing Feature 4: Dedicated Location Editor
- Status: Not Documented

#### Missing Feature 5: Duplicate Detection
- Status: Not Documented

#### Missing Feature 6: Default Country Setting
- Status: Not Documented

#### Missing Feature 7: Location Usage Statistics
- Status: Not Documented

## Issues and Observations

### Critical Issues
- None yet

### Medium Priority Issues
- None yet

### Low Priority Issues
- None yet

### Observations
- Test calendar has 10 existing events
- UI shows category filtering functionality
- Search functionality visible
