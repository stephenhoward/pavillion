# Spec Requirements Document

> Spec: Critical Workflow Fixes and UX Improvements
> Created: 2025-10-02
> Status: Planning

## Overview

Address critical blocking issues and high-priority UX problems identified during comprehensive QA testing. This spec focuses on fixing two mission-critical API endpoint failures (category management and admin account management), resolving usability issues that confuse users, and improving the overall user experience to make core workflows functional and intuitive.

## User Stories

### Story 1: Event Organizer Creates Organized Calendar

As an event organizer, I want to create and assign categories to my events so that attendees can easily find events by type and my calendar is well-organized.

**Current Problem:** The category management system is completely broken. API endpoints return 404 errors, preventing users from creating categories, assigning them to events, or filtering events by category. The "Add Category" button triggers JavaScript errors, and the entire category feature is non-functional despite having complete UI.

**Expected Experience:** Users can create event categories (e.g., "Community Events", "Workshops", "Performances"), assign multiple categories to events, and visitors can filter events by category to find what interests them.

### Story 2: Instance Administrator Manages User Accounts

As an instance administrator, I want to view and manage user accounts so that I can approve applications, send invitations, and maintain a healthy community.

**Current Problem:** The admin account management interface shows "No accounts on this server yet" despite the admin being logged in. API endpoints return 404 errors, preventing any user management. Administrators cannot process account applications, send invitations, or view existing users, making instance scaling impossible.

**Expected Experience:** Administrators can view all user accounts, approve/deny applications, send invitations, manage user permissions, and monitor account activity.


## Spec Scope

1. **Implement Missing Category API Endpoints** - Fix 404 errors for category CRUD operations, enable category creation/listing/assignment, resolve JavaScript focus() error
2. **Implement Admin Account Management API** - Fix account listing endpoint, enable user management interface, resolve invitations component errors
3. **Fix Calendar Name Validation UX** - Update placeholder text, improve error messages, make validation clearer to users
4. **Implement Missing Translation Keys** - Add missing i18n keys for admin interface, fix skip-to-content accessibility link
5. **Fix Event-Category Association Error (BLOCKING)** - Resolve Sequelize association error preventing event listings from loading with category data
6. **Add Event Date Display** - Show dates on event cards so users can see when events occur

## Out of Scope

- Public calendar routes (handled by separate site app infrastructure)
- Event duplication functionality (mentioned in roadmap but not blocking)
- Advanced category management (merging, migration) - Phase 1 feature
- Content moderation interface (Phase 4 feature)
- Federation testing with second instance (requires infrastructure)
- Password reset workflow testing (functional UI, not blocking)
- Image upload testing (interface complete, not blocking)
- Calendar deletion functionality (not visible in current UI)
- Event deletion UI (functionality may exist, just not obvious in interface)

## Expected Deliverable

1. **Category system fully functional** - Users can create categories, assign them to events, filter events by category, all without API errors or JavaScript warnings
2. **Admin interface operational** - Administrators can view accounts, process applications, send invitations, and manage users
3. **Calendar creation UX improved** - Clear validation guidance, helpful error messages, no confusion about accepted formats
4. **Admin interface polished** - All translation keys working, professional appearance, accessibility features functioning
5. **Backend stability restored** - Application runs without crashes, event listings load properly with category data, Sequelize associations correctly configured
6. **Event list enhanced** - Dates displayed on event cards, better usability for event management

## Spec Documentation

- Tasks: @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/tasks.md
- Technical Specification: @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/sub-specs/technical-spec.md
- API Specification: @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/sub-specs/api-spec.md
- Tests Specification: @.agent-os/specs/2025-10-02-critical-fixes-ux-improvements/sub-specs/tests.md
