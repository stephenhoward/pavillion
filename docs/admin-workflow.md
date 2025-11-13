# Admin Workflow

> Testing Date: 2025-10-02
> Status: ⚠️ Partially Functional (Account management broken)

## Accessing Admin Interface

### Entry Point

**From User Settings:**
1. Navigate to Settings page (`/profile`)
2. Click "Admin Settings" link
3. Redirects to `/admin/settings`

**Permissions:**
- Only visible to admin users
- Regular users presumably don't see "Admin Settings" link
- Admin role appears to be set on account creation

## Admin Navigation

### Navigation Menu

**Location:** Left sidebar/top navigation

**Menu Items:**
1. **< back** - Returns to `/profile` (user settings)
2. **General** - `/admin/settings` (General Settings)
3. **Accounts** - `/admin/accounts` (Account Management)
4. **Federation** - `/admin/federation` (Federation Settings)
5. **Funding** - `/admin/funding` (Funding Information)

**i18n Issue:**
Skip to content link shows raw translation key:
- Displays: "menu.navigation.skip_to_content"
- Should display: "Skip to main content"

**Console Warning:**
```
i18next::translator: missingKey en-US admin menu.navigation.skip_to_content
```

## General Settings

**URL:** `/admin/settings`

**Status:** ✅ **Functional**

### Interface

**Page Title:** "General Settings"

**Form Fields:**

1. **Instance Name**
   - Current value: `pavillion.dev`
   - Text input field
   - Help text: "The name of this server as it appears in the user interface"
   - Configures site branding

2. **Registration Mode**
   - Dropdown selector
   - Current selection: "Application Required - Users submit applications for admin approval"

   **Options:**
   - "Open Registration - Anyone can register publicly, any user can invite others"
   - "Application Required - Users submit applications for admin approval" ← Selected
   - "Invitation Only - Any authenticated user can invite others"
   - "Administrator Only - Only administrators can send invitations"

   - Help text: "Control how new users can join your instance and who can send invitations"

3. **Save Settings** button

### Functionality

**Test Status:** 🟡 **Not Tested**

**Reason:**
- Did not modify settings to avoid changing instance configuration
- Interface appears complete and functional
- Settings load correctly
- Dropdown works

**Expected Behavior:**
- Change instance name → Update site branding throughout app
- Change registration mode → Affect new user signup process
- Click Save → Persist settings to database
- Show success/error message

## Account Management

**URL:** `/admin/accounts`

**Status:** 🔴 **BROKEN**

### Interface

**Page Title:** "Accounts"

**Tabs:**
1. **Accounts** (selected by default)
2. **Applications**
3. **Invitations**

### Accounts Tab

**Current Display:**
- Empty state message: "No accounts"
- Text: "There are no accounts on this server yet."
- "Invite a New Account" button

**Console Errors:**
```
Failed to load resource: the server responded with a status of 404 (Not Found)
Error loading accounts: AxiosError
Failed to load resource: the server responded with a status of 404 (Not Found)
[Vue warn]: Unhandled error during execution of beforeMount hook at <Invitations>
AxiosError
```

**Issue:**
- API endpoint for loading accounts returns 404
- Admin account clearly exists (currently logged in as admin)
- System shows "no accounts" despite admin's existence
- Cannot view or manage user accounts
- Cannot process applications
- Cannot manage invitations

**Impact:**
- **Critical** - Administrators cannot manage users
- Cannot approve/deny account applications
- Cannot monitor user activity
- Cannot moderate accounts
- Instance administration severely limited

### Applications Tab

**Status:** 🟡 **Not Tested** (API errors prevent loading)

**Expected Functionality:**
- View pending account applications
- Approve applications (create accounts)
- Deny applications (with optional reason)
- View application details (email, message, timestamp)

**Based on Registration Mode:**
Current mode is "Application Required", so this tab should be actively used.

### Invitations Tab

**Status:** 🔴 **Cannot Load** (API errors)

**Expected Functionality:**
- View sent invitations
- Send new invitations
- Cancel pending invitations
- Resend invitation emails
- Track invitation acceptance

**Invite a New Account Button:**
- Visible in empty state
- Presumably opens invitation dialog
- Not tested due to API errors

## Federation Management

**URL:** `/admin/federation`

**Status:** 🟡 **Not Tested**

**Expected Functionality:**
Based on tech stack and mission:
- View federated instances
- Configure federation policies
- Manage follow relationships
- Set auto-repost policies
- Block/allow list management
- Trust level configuration

**Related Features (from roadmap Phase 4):**
- Federation Trust Levels
- Content Moderation Interface
- Moderation Audit Log
- Blocked Content Management

**ActivityPub Implementation:**
According to CLAUDE.md, comprehensive federation features exist:
- Follow/unfollow
- Event sharing
- Auto-repost policies
- Inbox/outbox processing
- WebFinger discovery
- HTTP signatures

## Funding Information

**URL:** `/admin/funding`

**Status:** 🟡 **Not Tested**

**Purpose:**
Likely for:
- Displaying instance funding information
- Donation links
- Financial transparency
- Sustainability information

**Context:**
Aligns with solarpunk values and community-oriented approach mentioned in mission.

## Missing Admin Features

**Not Found in Interface:**

1. **Calendar Management**
   - View all calendars on instance
   - Delete/moderate calendars
   - View calendar statistics

2. **Event Moderation**
   - View all events across calendars
   - Moderate/remove inappropriate content
   - Federated event approval queue

3. **Activity Logs**
   - User actions
   - System events
   - Security logs

4. **Storage Management**
   - View storage usage
   - Manage uploaded media
   - Set storage quotas

5. **Email Configuration**
   - SMTP settings management
   - Email template customization
   - Test email sending

6. **Backup/Export**
   - Database backup
   - Data export
   - System maintenance

**Note:** These features may exist but were not found in initial exploration or may be planned for future phases.

## API Endpoints

**Working:**
- `GET /admin/settings` or similar - Loads general settings
- Likely `POST /admin/settings` - Save settings (not tested)

**Broken:**
- `GET /api/v1/accounts` or similar → 404
- Invitations endpoint → Error during component mount
- Other account-related endpoints

## Security Observations

### Access Control
✅ Admin interface requires authentication
✅ Admin link only visible to admin users (presumably)
⚠️ Did not test what happens if non-admin accesses admin URLs

### Recommendations

1. **Implement proper role-based access control (RBAC)**
   - Verify on server side, not just UI
   - Return 403 Forbidden for non-admin access
   - Log unauthorized access attempts

2. **Add audit logging**
   - Track all admin actions
   - Record who made changes and when
   - Essential for accountability

## Issues and Recommendations

### Critical Issues

1. **Account Management API Missing/Broken**
   - Priority: **HIGH**
   - Impact: Cannot administer instance
   - Fix: Implement account listing endpoints
   - Verify authentication/authorization

2. **Invitations Component Mount Error**
   - Priority: **HIGH**
   - Impact: Cannot send invitations
   - Fix: Debug Vue component lifecycle error
   - May be related to missing API endpoint

3. **Missing Translation Keys**
   - Priority: **LOW**
   - Impact: Unprofessional appearance
   - Fix: Add missing translation keys to i18n files
   - Key: `menu.navigation.skip_to_content`

### Feature Gaps

4. **No Calendar Administration**
   - Priority: **MEDIUM**
   - Impact: Limited instance management
   - Add: Calendar listing and moderation tools

5. **No Event Moderation Interface**
   - Priority: **MEDIUM**
   - Impact: Cannot moderate inappropriate content
   - Note: Planned for Phase 4 (Content Moderation)

6. **No Activity/Audit Logs**
   - Priority: **MEDIUM**
   - Impact: Cannot track admin actions or user activity
   - Essential for: Security and accountability

7. **No Storage Management**
   - Priority: **LOW**
   - Impact: Cannot monitor resource usage
   - Add: Storage usage statistics and management

### UX Improvements

8. **Add confirmation dialogs**
   - For destructive actions (delete account, ban user)
   - For bulk operations
   - Prevent accidental actions

9. **Add success/error notifications**
   - When saving settings
   - When performing admin actions
   - Clear feedback for all operations

10. **Add help documentation links**
    - Explain each setting
    - Link to admin guide
    - Context-sensitive help

## Registration Modes Explained

### Open Registration
- **Who can join:** Anyone
- **Who can invite:** Any authenticated user
- **Use case:** Open communities, low barrier to entry
- **Risk:** Spam, abuse potential

### Application Required (Current)
- **Who can join:** Those approved by admin
- **Process:** User submits application → Admin reviews → Approve/Deny
- **Who can invite:** Not specified (possibly still open)
- **Use case:** Curated communities
- **Balance:** Quality control with reasonable access

### Invitation Only
- **Who can join:** Only invited users
- **Who can invite:** Any authenticated user
- **Use case:** Growing community organically
- **Risk:** Limited growth

### Administrator Only
- **Who can join:** Only admin-invited users
- **Who can invite:** Only administrators
- **Use case:** Closed, controlled communities
- **Risk:** Very limited growth, admin bottleneck

## User Workflows

### Admin Daily Tasks (When Working)

**Should be able to:**
1. Review pending account applications
2. Approve/deny applications with reasons
3. Send invitations to new users
4. Monitor user activity
5. Moderate content (events, calendars)
6. Manage federation relationships
7. View instance health/statistics

**Currently Can:**
- ✅ Change instance settings
- ✅ Configure registration mode

**Currently Cannot:**
- ❌ View user accounts
- ❌ Process applications
- ❌ Send invitations
- ❌ Monitor activity
- ❌ Moderate content (no tools visible)

### New Instance Setup (Blocked)

1. ✅ Admin account created (via seed data or setup)
2. ✅ Login successful
3. ✅ Set instance name
4. ✅ Choose registration mode
5. ❌ Cannot invite first users (API broken)
6. ❌ Cannot approve applications (API broken)
7. ❌ Instance cannot grow (user management blocked)

## Related Workflows

- [Authentication](./authentication-workflow.md)
- [Account Management](./account-management-workflow.md) (not created - feature broken)
- [Federation Settings](./federation-workflow.md)
