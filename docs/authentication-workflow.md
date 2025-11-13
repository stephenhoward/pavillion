# Authentication Workflow

> Testing Date: 2025-10-02
> Status: ✅ Functional

## Login Process

### Happy Path

**URL:** `http://localhost:3000/auth/login` (automatically redirects from root)

**Interface Elements:**
- Site branding: "pavillion.dev" header
- Form title: "Sign in to your account"
- Email input field
- Password input field (type="password")
- "Sign in" button
- "Apply for an Account" button
- "Forgot Password?" link

**Test Results:**
✅ **PASS** - Login successful with admin credentials

**Steps:**
1. Navigate to localhost:3000
2. Automatically redirected to `/auth/login`
3. Enter email: `admin@pavillion.dev`
4. Enter password: `admin`
5. Click "Sign in" button
6. Successfully authenticated
7. Redirected to `/calendar` (calendar management page)

**Post-Login State:**
- Navigation menu appears with: New Event, Calendar, Feed, Inbox, Settings
- User session established
- JWT token stored (based on tech stack using passport-jwt)

### Validation

**Form Validation:**
- Input elements lack `autocomplete` attributes (Console warning suggests "current-password" should be added)
- No visible client-side validation errors observed
- Form submission appears to rely on server-side validation

**Console Warnings:**
```
[DOM] Input elements should have autocomplete attributes (suggested: "current-password")
```

**Recommendation:** Add appropriate autocomplete attributes for better UX and security:
- Email field: `autocomplete="email"`
- Password field: `autocomplete="current-password"`

## Account Registration

### Application Process

**Interface:**
- "Apply for an Account" button present on login page
- Registration mode configured as "Application Required" (verified in Admin → General Settings)

**Status:** 🟡 **NOT FULLY TESTED**

**Notes:**
- Button is visible and clickable
- Did not complete registration flow to avoid polluting test data
- Based on admin settings, application workflow should require admin approval
- Registration modes available:
  - Open Registration (anyone can register, any user can invite)
  - Application Required (submit application for admin approval) ← Currently active
  - Invitation Only (any authenticated user can invite)
  - Administrator Only (only admins can send invitations)

## Password Reset

**Interface:**
- "Forgot Password?" link present on login page
- Link target: `/auth/forgot?email=`

**Status:** 🟡 **NOT TESTED**

**Reason:** Focused on testing primary workflows first

**Expected Flow (not verified):**
1. Click "Forgot Password?" link
2. Enter email address
3. System sends reset link via email (Nodemailer configured in tech stack)
4. User receives email with reset token
5. User clicks link to reset password page
6. User enters new password
7. Password updated, user can log in

## Logout

**Interface:**
- "Logout" link in Settings page: `/auth/logout`

**Status:** 🟡 **NOT TESTED**

**Reason:** Would require re-login to continue testing

**Expected Behavior:**
- Click logout link
- Session terminated
- JWT token invalidated
- Redirect to login page

## Session Management

**Observed Behavior:**
- Session persists across page navigation
- Authentication state maintained throughout testing session
- Navigation menu consistently appears after login
- No unexpected logouts during testing

**Backend Technology:**
- Passport.js for session management (v0.7+)
- JWT tokens for API authentication (passport-jwt 4.0+)
- Local authentication strategy (passport-local 1.0+)

## Security Observations

### Strengths
✅ Password field properly masked
✅ Separate authentication layer for API access
✅ HTTP signature support for ActivityPub federation (http-signature 1.4+)
✅ Session-based authentication with JWT for API calls

### Areas for Improvement
⚠️ Missing autocomplete attributes on login form
⚠️ No visible rate limiting on login attempts (not tested extensively)
⚠️ No visible two-factor authentication option

## User Experience

### Positive Aspects
- Clean, simple login interface
- Clear labeling of form fields
- Prominent "Forgot Password?" link for recovery
- "Apply for an Account" clearly visible for new users
- Fast login response time
- Smooth redirect after authentication

### Minor Issues
- Console warning about autocomplete attributes
- No visible "Remember me" checkbox option
- No indication of password requirements before submission
- Error messages not tested (did not attempt invalid logins)

## Integration Points

**Authentication integrates with:**
- Calendar management (user-specific calendar listing)
- Event creation (events associated with user's calendar)
- Admin interface (role-based access control)
- Federation (ActivityPub actor identity tied to account)
- Settings (user preferences and account management)

## Multi-language Support

**i18n Configuration:**
- i18next 25.0+ for translations
- Browser language detection available (i18next-browser-languagedetector 8.1+)
- Console shows: "i18next: languageChanged en-US" and "i18next: initialized"

**Observed:**
- Interface rendered in English (US)
- Language initialization successful
- No translation issues visible in authentication interface

## Accessibility

**Observations:**
- "Skip to main content" link available (good for screen readers)
- Form fields appear to have proper labels
- Button text is clear and descriptive

**Not Verified:**
- Keyboard navigation flow
- Screen reader compatibility
- ARIA labels completeness
- Color contrast ratios
- Focus indicators

## API Endpoints (Inferred)

Based on successful login, these endpoints are functional:
- `POST /auth/login` or similar - Authentication endpoint
- Session/cookie management endpoints
- JWT token generation endpoints

## Recommendations

### High Priority
1. Add `autocomplete` attributes to login form inputs
2. Test password reset workflow completely
3. Test registration/application workflow
4. Implement rate limiting for login attempts (if not already present)

### Medium Priority
5. Consider adding "Remember me" functionality
6. Display password requirements on the form
7. Test error handling for invalid credentials
8. Add two-factor authentication option

### Low Priority
9. Consider adding social login options if appropriate for use case
10. Add login attempt monitoring for security audit

## Related Workflows

- [Calendar Management](./calendar-management-workflow.md)
- [Admin Interface](./admin-workflow.md)
- [Settings/Profile](./settings-workflow.md)
