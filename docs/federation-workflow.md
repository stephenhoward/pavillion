# Federation Workflow

> Testing Date: 2025-10-02
> Status: ✅ UI Functional (Empty states - no federation data to test)

## Overview

Pavillion implements ActivityPub federation to allow calendar instances to share events and follow each other across the federated network. This enables community curators to aggregate events from multiple sources.

**Implementation Status (from CLAUDE.md):**
✅ Comprehensive ActivityPub federation including:
- Follow/unfollow functionality
- Event sharing across instances
- Auto-repost policies
- Inbox/outbox processing
- WebFinger discovery
- HTTP signatures

## Navigation

**Main Menu Items:**
- **Feed** - View federated events and manage follows
- **Inbox** - View notifications about follows and reposts

Both are accessible from main navigation at all times after login.

## Feed Page

**URL:** `/feed`

**Status:** ✅ **UI Functional**

### Interface Tabs

1. **Events** (default selected)
2. **Following**
3. **Followers**

### Events Tab

**Current Display:**
- Empty state region
- Heading: "No events"
- Call-to-action button: "Follow a Calendar"

**Console Warnings:**
```
[Vue warn]: Extraneous non-emits event listeners (openEvent) were passed to component
```

**Expected Behavior (when populated):**
- Display federated events from followed calendars
- Show events in chronological order
- Allow filtering and searching
- Click event to view details
- Possibly repost events to own calendar

**"Follow a Calendar" Button:**
- Status: 🟡 **Not Tested**
- Expected: Opens dialog to search for and follow remote calendars
- Input: Calendar identifier (e.g., `calendar@remote-instance.com`)
- Action: Send ActivityPub follow request
- Result: Calendar added to Following list

### Following Tab

**Status:** 🟡 **Not Tested**

**Expected Functionality:**
- List of calendars this account follows
- Show calendar names and instances
- "Unfollow" button per calendar
- View calendar's federated events
- Filter events by followed calendar

**Use Case:**
Community curator follows:
- Local business calendars
- Nonprofit event calendars
- City government calendar
- Tourist board calendar

All events appear in federated feed, can be reposted to curator's community calendar.

### Followers Tab

**Status:** 🟡 **Not Tested**

**Expected Functionality:**
- List of accounts/calendars following this user's calendar(s)
- Show follower names and instances
- Ability to block/remove followers
- View who is consuming your calendar feed

**Use Case:**
Event organizer sees which community calendars are following their events, understands reach.

## Inbox Page

**URL:** `/inbox`

**Status:** ✅ **UI Functional**

### Interface

**Current Display:**
- Empty state region
- Heading: "You have no notifications."
- Description: "Notifications of follows and reposts"

**Expected Notifications (when active):**
1. **Follow Notifications**
   - "Calendar X started following your calendar"
   - Accept/reject follow requests (if instance uses approval)
   - View follower profile/calendar

2. **Repost Notifications**
   - "Calendar Y reposted your event Z"
   - View the repost
   - See engagement metrics

3. **Mention Notifications** (possible)
   - If ActivityPub mentions are supported
   - @ mentions in event descriptions or comments

**Notification Actions:**
- Mark as read/unread
- Delete notifications
- Quick actions (view event, view calendar, follow back)

## ActivityPub Implementation

### Technical Architecture

**Based on tech-stack.md:**

**Libraries:**
- `activitypub-express 4.4+` - Federation protocol
- `http-signature 1.4+` - Secure federation authentication

**Supported Activities (from CLAUDE.md):**
- ✅ Follow/Unfollow
- ✅ Event sharing (Create, Update, Delete)
- ✅ Auto-repost with configurable policies
- ✅ Inbox/Outbox processing
- ✅ WebFinger discovery
- ✅ HTTP signature verification

### WebFinger Discovery

**Purpose:** Allows finding calendars by identifier

**Example:**
User searches for `community-calendar@city-events.org`

**Process:**
1. System queries `https://city-events.org/.well-known/webfinger?resource=acct:community-calendar@city-events.org`
2. Receives ActivityPub actor URL
3. Fetches actor profile
4. Displays calendar for user to follow

### HTTP Signatures

**Purpose:** Verify authenticity of federated requests

**Implementation:**
- All ActivityPub requests signed with HTTP signatures
- Prevents impersonation
- Ensures message integrity
- Required for trusted federation

## Auto-Repost Policies

**Status:** ✅ **Implemented** (not visible in UI tested)

**Purpose:**
Automatically repost events from trusted calendars to your calendar without manual approval.

**Configuration Levels (expected):**
1. **Always auto-repost** - Full trust
2. **Require approval** - Review before reposting
3. **Never auto-repost** - Manual repost only
4. **Block** - Don't show events from this calendar

**Use Case:**
City tourism board might:
- Auto-repost from verified business calendars
- Require approval from individual organizers
- Block spam/inappropriate calendars

**Location (expected):**
- Per-followed-calendar setting
- Admin → Federation settings
- Calendar management interface

## Federation Workflow Scenarios

### Scenario 1: Following a Remote Calendar

**Status:** 🟡 **Not Tested** (UI present, no remote instance available)

**Expected Steps:**
1. Click "Follow a Calendar" in Feed
2. Enter calendar identifier: `local-events@community.org`
3. System performs WebFinger discovery
4. Display calendar preview (name, description, event count)
5. Click "Follow"
6. System sends ActivityPub Follow activity
7. Remote instance may:
   - Accept automatically
   - Require manual approval
8. Followed calendar appears in "Following" tab
9. Events appear in "Events" feed

### Scenario 2: Being Followed

**Status:** 🟡 **Not Tested**

**Expected Steps:**
1. Remote calendar sends Follow activity
2. Notification appears in Inbox: "X wants to follow your calendar"
3. User reviews follower
4. User accepts or rejects follow
5. If accepted:
   - Follower appears in "Followers" tab
   - Follower receives your events in their feed
6. If rejected:
   - Follower not added
   - No events shared

### Scenario 3: Reposting a Federated Event

**Status:** 🟡 **Not Tested**

**Expected Steps:**
1. View event in federated feed
2. Click "Repost" or similar action
3. Select which of your calendars to repost to
4. Optionally modify event details
5. Confirm repost
6. Event copied to your calendar
7. Original event owner receives notification
8. Event maintains link to original (attribution)

### Scenario 4: Auto-Repost from Trusted Calendar

**Status:** 🟡 **Not Tested**

**Expected Steps:**
1. Follow a calendar
2. Set auto-repost policy to "Always"
3. Remote calendar creates new event
4. Event automatically appears in your calendar
5. No manual intervention required
6. Notification (optional) about auto-repost

## Trust and Moderation

### Trust Levels (Phase 4 Planned Feature)

**From roadmap.md Phase 4:**
- Instance trust level configuration
- Trusted, neutral, blocked classifications
- Cross-instance reputation tracking
- Trust-based content filtering
- Auto-repost policy management based on trust

**Impact on Federation:**
- High-trust instances → Auto-repost, minimal filtering
- Neutral instances → Manual approval
- Blocked instances → No content received

### Content Moderation (Phase 4 Planned)

**Planned Features:**
- Moderation queue for federated events
- Approve/reject workflows
- Batch moderation operations
- Content preview and source info
- Moderation audit log
- Block instance/user/calendar
- Content pattern blocking

**Use Case:**
Instance admin can review incoming federated events before they appear publicly, ensuring community standards are maintained.

## Public Calendar Federation

**Status:** 🔴 **BLOCKED** by missing public calendar routes

**Issue:**
- Public calendar routes not configured
- External instances cannot access calendar data
- Federation may not work for event sharing
- WebFinger discovery likely broken

**Impact on Federation:**
- Other instances cannot follow this instance's calendars
- Cannot participate in federated network
- Events cannot be shared with federated instances
- Core federation functionality non-operational

**Critical Blocker:**
Public routes (`/site/{calendarName}` or similar) must be implemented for federation to work. External instances need anonymous access to:
- Calendar metadata
- Event listings
- ActivityPub actor profiles
- WebFinger endpoints

## API Endpoints (Expected)

**ActivityPub Standard Endpoints:**
- `/.well-known/webfinger` - WebFinger discovery
- `/ap/users/{username}` - Actor profile (JSON-LD)
- `/ap/users/{username}/inbox` - Receive activities
- `/ap/users/{username}/outbox` - Published activities
- `/ap/users/{username}/followers` - Followers collection
- `/ap/users/{username}/following` - Following collection

**Custom Endpoints (inferred):**
- `POST /api/v1/calendars/{id}/follow` - Follow a calendar
- `DELETE /api/v1/calendars/{id}/follow` - Unfollow
- `GET /api/v1/feed/events` - Federated events feed
- `POST /api/v1/events/{id}/repost` - Repost event
- `GET /api/v1/notifications` - Inbox notifications

**Status:** Not verified (no federated testing performed)

## Console Warnings

### Extraneous Event Listeners

```
[Vue warn]: Extraneous non-emits event listeners (openEvent) were passed to component
```

**Impact:**
- Vue component receiving events it doesn't declare
- Possible functionality issue when clicking events in feed
- Should be resolved for proper event handling

**Recommendation:**
- Add `openEvent` to component's `emits` option
- Or handle event properly in parent component
- Verify event detail viewing works correctly

## Testing Limitations

**Why Federation Not Fully Tested:**

1. **Single Instance**
   - Only one Pavillion instance running (localhost:3000)
   - Cannot test cross-instance federation
   - Would need second instance to test follow/repost

2. **No Remote Calendars**
   - No other ActivityPub calendar instances available
   - Cannot test WebFinger discovery
   - Cannot test following external calendars

3. **Public Routes Broken**
   - Even if second instance existed, couldn't access calendars
   - Federation requires public access to calendar data

4. **Time Constraints**
   - Setting up second instance would be extensive
   - Focus on documenting current state
   - Federation backend appears complete, needs integration testing

## Recommendations

### Critical for Federation

1. **Implement Public Calendar Routes**
   - Priority: **CRITICAL**
   - Essential for federation to work
   - Blocks entire federated network functionality

2. **Fix Event Listener Warning**
   - Priority: **MEDIUM**
   - May affect event viewing in feed
   - Clean up component props/events

3. **Set Up Test Federation Environment**
   - Priority: **HIGH**
   - Deploy second instance for testing
   - Verify follow/unfollow works
   - Test event sharing end-to-end
   - Validate WebFinger discovery

### Enhancements

4. **Add Federation Status Indicators**
   - Show connection status to followed instances
   - Indicate auto-repost status
   - Display federation health

5. **Improve Empty States**
   - Explain what federation is
   - Provide example calendar identifiers to follow
   - Link to federation documentation
   - Show benefits of following calendars

6. **Add Search in Following/Followers**
   - Filter by instance
   - Search by calendar name
   - Sort by activity level

7. **Federation Analytics**
   - Show event reach across instances
   - Count followers/following
   - Track repost engagement
   - Instance popularity metrics

## Comparison with Mission

**Mission Requirements:**
✅ "ActivityPub-based federation" - Implemented
✅ "Share events across multiple instances" - Code present
✅ "Community curators to aggregate events" - Feed structure supports
⚠️ "Federated Event Sharing" - Implemented but untested
🔴 Public access required for federation - **BLOCKED**

**Differentiator:**
"Decentralized Federation with Local Control" - Infrastructure exists, needs public routes to be operational.

## Related Workflows

- [Public Calendar Viewing](./public-calendar-workflow.md) - **CRITICAL DEPENDENCY**
- [Calendar Management](./calendar-management-workflow.md)
- [Admin Interface](./admin-workflow.md)
- [Content Moderation](./moderation-workflow.md) (Phase 4 - not yet implemented)
