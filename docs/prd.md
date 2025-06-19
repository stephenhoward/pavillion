# Pavillion: Product Requirements Document

## Overview

Pavillion is a federated events calendar system designed to help organizations share their events with the public and create community-oriented calendars that aggregate events from multiple sources. Using federation technology, Pavillion enables easy sharing and discovery of events across different communities while maintaining local autonomy and control.

## Background and Strategic Fit

Communities and organizations often struggle to maintain awareness of local events. Current solutions are typically either:

1. Centralized commercial platforms with privacy concerns and limited control
2. Isolated calendars that don't connect with other community resources
3. Manual aggregation processes that are labor-intensive and often outdated

Pavillion addresses these issues by creating a federated network of event calendars that preserves autonomy while enabling easy sharing.

## Project Principles

### Accessibility
- Multilingual support out of the box for both UI and content
- Built-in translation tools for cross-language event sharing
- Screen reader compatibility and accessibility-focused design
- Structured event information to communicate accessibility details

### Autonomy
- Open source codebase licensed under Mozilla Public License 2.0 (MPL-2.0)
- Decentralized architecture with no central authority
- Public viewing without registration requirements
- Instance-level control over content moderation and federation

### Flexibility
- Embeddable calendar widgets for external websites
- Export/sync capabilities to major platforms (e.g., Facebook, Google Calendar)
- API for third-party integrations
- Configurable account creation modes (open, invitation, application, closed)

### Community
- Design centered around community connection
- Features that encourage discovery of local events
- Tools for community calendar curation

## User Types

1. **Event Attendees/Calendar Viewers**
   - People seeking events to attend
   - Do not create or require accounts in the system
   - Interact with calendars as anonymous visitors only
   - Accounts exist only for the other user types (organizers, curators, administrators)
   - Can freely access public calendar content without any registration
   - Expected to use the system as they would any public website
   - No personal data collection required for core functionality
   - Design prioritizes privacy and ease of access without barriers
   - May interact with embedded calendars on third-party sites
   - Should be able to view events in any configured language
   - Can view and filter events without tracking or profiling

2. **Event Organizers & Community Curators**
   - Individuals or organizations creating, managing, and curating events
   - In practice, often the same people filling both roles
   - May own a primary calendar for their personal or organizational use
   - May exist solely as contributors to calendars owned by others
   - May have editing permissions on multiple calendars owned by others
   - Responsible for event details, updates, and management
   - May manage recurring events and location information
   - Can create content in multiple languages
   - May follow other calendars for inspiration or coordination
   - Manage calendar federation relationships when needed
   - Configure auto-repost policies based on trust level
   - Perform moderation of federated content
   - Create and maintain categories for organizing and filtering events
   - Maintain and map category systems between federated calendars
   - May invite others to create organizer/curator accounts in 'open' and 'invitation' modes (admins can always invite)

3. **Instance Administrators**
   - People managing Pavillion servers
   - Configure instance-wide settings
   - Manage user accounts and permissions
   - Control federation policies and connections
   - Monitor system health and performance
   - Manage registration modes and approval processes
   - Responsible for backups and system maintenance

## Core Features

### Federation System
- ActivityPub protocol implementation for server-to-server communication
- Follow mechanism to subscribe to remote calendars
- Event sharing across instances
- WebFinger implementation for user/calendar discovery

### Account Management
- Multiple registration modes (open, invitation, application, closed)
- Password management (reset, recovery)
- Admin tools for account oversight
- Profile management

### Calendar Management
- Optional primary calendar ownership per account
- Accounts can exist solely to contribute to others' calendars
- Permission-based access to edit other users' calendars
- Collaborative editing permissions for organizational calendars
- Customizable display options
- Calendar following across instances

### Event Management
- Create, read, update, delete operations
- Recurring event support with flexible scheduling
- Managing event location information
- Multi-language event descriptions
- Rich media support for event details
- Event categories and tagging
- Parent-child event relationships for hierarchical organization

### Content Discovery
- Event feeds from followed calendars
- Search functionality (local and federated)
- Filtering by date, type, location, etc.
- Parent event filtering to view all child events within a larger event
- Hierarchical navigation between related events
- Ability to see all components of multi-day festivals or conferences

### User Interface
- Responsive web design for mobile and desktop
- Dark mode support
- Accessible design practices
- Embeddable widgets for external sites

## Detailed Requirements

### Federation Requirements

1. **Follow System**
   - Users must be able to follow remote calendars by their identifier
   - Events from followed calendars should appear in user's feed
   - Users must be able to unfollow calendars
   - Follows must generate appropriate ActivityPub activities
   - Per-calendar auto-repost policy configuration:
     - No auto-repost (manual sharing only)
     - Auto-repost only events that originate from the followed calendar
     - Auto-repost all events including those the followed calendar has reposted
   - Visual indicators for reposted vs. original content
   - Ability to modify auto-repost settings at any time
   - Admin controls to override or limit auto-repost functionality

2. **Event Sharing**
   - Events must be shareable across instances
   - Manual sharing/reposting of individual events
   - Automatic reposting based on per-calendar follow policy
   - Sharing provenance must be preserved (original source + sharing path)
   - Updates to events must propagate to followers
   - Deletions must notify followers
   - Federation must handle varying time zones correctly
   - Reposted events must maintain attribution to original creator
   - Users must be able to remove previously auto-reposted events
   - Category mapping system for cross-instance interoperability:
     - Interactive category mapping during repost workflow
     - System remembers previous category mappings by source
     - Ability to review and modify mappings after reposting
     - Bulk category remapping for multiple events
     - Protection of host calendar's category system integrity

3. **Discovery Protocol**
   - WebFinger implementation for discovering remote users/calendars
   - Server information endpoint describing instance capabilities
   - Profile pages accessible via ActivityPub

### Authentication Requirements

1. **Account Creation Modes**
   - Administrator-configurable setting that can be changed at any time
   - **Open**: Anyone can self-register for an account without approval
   - **Invitation**: Any account holder can invite another account holder to register
   - **Application**: Users submit applications that administrators must review and approve
   - **Closed**: Only administrators can initiate account creation by sending invitations (they can invite under any mode)
   - Email verification regardless of creation mode
   - Administrator interface for managing mode transitions

2. **Security**
   - Secure password storage with modern hashing
   - JWT-based authentication
   - Password reset functionality
   - Session management
   - Rate limiting for authentication attempts

### Calendar Management Requirements

1. **Calendar Ownership Model**
   - Users may opt to create a primary calendar or exist without one
   - Calendar creation can be deferred until needed
   - Users without calendars can still contribute to others' calendars
   - Organizations are represented by a primary account and calendar
   - Binary permission model: either full edit access or no access
   - Clear indication of which calendar a user is currently editing
   - Ability to switch between calendars the user has access to
   - User-specific settings preserved across calendars they can edit

2. **Collaboration System**
   - Simple binary permission model: editor access or no access
   - Calendar owners can invite other accounts as editors
   - Email-based invitation workflow for non-registered users
   - Account-based invitation for existing system users
   - Ability to revoke access at any time by calendar owner
   - Notification system for pending invitations
   - Editor management interface for calendar owners
   - Activity logging of editor actions
   - Ability for editors to remove themselves from calendars
   - Architecture supports future role expansion if needed

3. **Calendar Navigation**
   - Monthly, weekly, daily, agenda views
   - Timeline view for continuous scrolling
   - Calendar switching interface for editors with multiple permissions
   - Custom color coding and visual distinction

### Event Management Requirements

1. **Event Creation**
   - Title, description, date/time fields
   - Location with address details
   - Categories and tags
   - Privacy/visibility options
   - Rich text formatting for descriptions
   - Multilingual content support
   - Parent-child event relationships:
     - Events can be designated as part of larger parent events
     - Example: individual performances within a week-long festival
     - Child events inherit certain properties from parent events
     - Visual indication of event hierarchy in calendar views
     - Ability to filter/view all events within a parent event
     - Calendar viewers can filter to see all related events in a larger event
     - Option to see only parent events or to expand and see all child events
     - Navigation between related events

2. **Recurring Events**
   - Daily, weekly, monthly, yearly patterns
   - Custom recurrence rules (every X days, nth weekday of month)
   - Exclusion dates
   - End conditions (after X occurrences, specific end date)

3. **Location Information Management**
   - Address storage and reuse within a calendar
   - Location autocomplete from previously used locations
   - Map integration (optional)
   - Location search
   - Location history for quick selection
   - Efficient reuse of locations across events in the same calendar

4. **Multilingual Support**
   - Per-field language variants
   - Language selection interface
   - Default language settings
   - Translation suggestions (future)

5. **Category Management**
   - Curated list of categories maintained by calendar owner
   - Hierarchical category structure (optional)
   - Category visibility controls
   - Category-based filtering for viewers
   - Category mapping system for federated events:
     - Just-in-time mapping during repost process
     - Remembered mappings for repeat sources
     - Bulk category remapping interface for past events
     - Default category for unmapped imported categories
     - Protection against unauthorized category system changes
     - Visual distinction between local and imported event categories

### User Interface Requirements

1. **Calendar Views**
   - Month grid view
   - Week view with time slots
   - Day detailed view
   - List/agenda view
   - Feed view for social-style browsing
   - Parent event view showing all related sub-events
   - Visual indicators for events that are part of larger events
   - Collapsible/expandable event hierarchies
   - Methods to navigate between parent and child events

2. **Mobile Support**
   - Responsive design
   - Touch-friendly controls
   - Optimized views for small screens
   - Native app feel in browser

3. **Accessibility**
   - WCAG 2.1 AA compliance
   - Screen reader compatibility
   - Keyboard navigation
   - High contrast options
   - Respects system preferences

### Administration Requirements

1. **Instance Settings**
   - Federation controls (allow/block domains)
   - Account creation mode configuration (open/application/invitation/closed)
   - Ability to toggle account creation modes as needed
   - Site branding and customization
   - Default language settings

2. **User Management**
   - Account approval/rejection
   - Role assignment
   - Account suspension
   - Content moderation tools
   - Calendar collaboration oversight
   - Ability to transfer calendar ownership
   - Audit logs for permission changes

3. **System Monitoring**
   - Basic activity logging
   - Federation connection status
   - Error reporting
   - Performance metrics

## Technical Requirements

1. **Architecture**
   - Domain-driven design with clear boundaries between functional areas
   - Each domain (authentication, calendar, federation, etc.) to have its own:
     - API endpoints and controllers
     - Service layer for business logic
     - Domain models
     - Data entities
   - Domains must maintain clear interfaces for inter-domain communication
   - Initial deployment as single server with domain boundaries preserved
   - Architecture must support future decomposition into microservices
   - Containerization-ready design for eventual deployment in orchestrated environments

2. **Performance**
   - Calendar view rendering under 2 seconds
   - Event creation response under 1 second
   - Federation activities processed asynchronously
   - Handle calendars with 1000+ events

3. **Scalability**
   - Support up to 10,000 users per instance
   - Handle federation with 100+ other instances
   - Efficient database queries for large event sets
   - Caching strategies for frequently accessed data
   - Ability to scale domains independently when deployed as microservices

4. **Reliability**
   - 99.9% uptime goal
   - Consistent backups
   - Graceful handling of network issues
   - Retry mechanisms for federation communication
   - Resilience patterns between domain boundaries

5. **Security**
   - HTTPS required
   - HTTP signatures for federation authentication
   - JWT for client authentication
   - Input validation and sanitization
   - Protection against common web vulnerabilities
   - Domain isolation to minimize security breach impacts

6. **Input Validation**
   - Comprehensive validation for all user inputs
   - Sanitization to prevent XSS and injection attacks
   - Email format validation with disposable email detection
   - Rate limiting for form submissions
   - Size limits for all text inputs and file uploads
   - Content type validation for all uploads
   - Malicious pattern detection in user-generated content
   - Client-side validation for UX with server-side validation for security
   - Standardized error responses for validation failures
   - Configuration options for validation rules per content type

7. **Database Transactions**
   - ACID compliance for all critical operations
   - Transaction support for operations spanning multiple entities
   - Proper rollback handling for error scenarios
   - Optimistic concurrency control for collaborative editing
   - Consistent state preservation during complex operations
   - Idempotent operations where applicable
   - Retry mechanisms for temporary failures
   - Monitoring and alerting for transaction failures
   - Performance optimization for transaction-heavy workflows
   - Connection pooling and transaction timeout management

## Future Considerations

1. **Integration Possibilities**
   - Export to iCal/CSV formats
   - Import from common calendar formats
   - Integration with other federated platforms (Mastodon, etc.)
   - API for third-party applications

2. **Enhanced Features**
   - Event RSVPs and attendance tracking
   - Event ticketing (free/paid)
   - Comments and discussion on events
   - Event promotion and featured listings
   - Event highlighting and featuring capabilities
   - Pin events to top of calendar views

3. **Advanced Federation**
   - Federation groups/collections
   - Federated search
   - Trust networks for content moderation
   - Cross-instance user permissions

4. **Infrastructure Evolution**
   - Full microservices deployment for large instances
   - Domain-specific scaling based on usage patterns
   - Kubernetes/container orchestration reference configurations
   - Multi-region deployment options
   - Performance metrics and auto-scaling per domain
   - Pluggable domain implementation for community extensions

5. **Rate Limiting**
   - Advanced rate limiting based on user behavior patterns
   - Adaptive rate limits based on server load and traffic
   - IP-based and account-based rate limiting strategies
   - Graduated response to rate limit violations
   - Rate limit federation activities to prevent instance flooding
   - Clear feedback for users approaching or exceeding limits
   - Analytics for rate limit violations to identify potential attacks

6. **Location Information Sharing**
   - Cross-calendar location sharing with owner permission
   - Opt-in model for making location records available to other calendar owners
   - Permission controls for allowing others to view vs. edit shared locations
   - Contribution model for collaborative improvement of location information
   - Version control for location records to track changes
   - Community-verified location database
   - Rich location information including accessibility details, photos, etc.
   - Federated location sharing across instances

## Implementation Phases

### Phase 1: Core Functionality
- Basic calendar and event management
- User authentication system
- Fundamental ActivityPub implementation
- Single calendar per user
- Basic UI views
- Domain-driven architecture establishment with clear boundaries
- Single-server deployment model

### Phase 2: Federation Enhancement
- Follow/follower relationship management
- Federated timeline
- Remote event display
- Enhanced ActivityPub compliance
- Refinement of domain interfaces
- Performance optimization within domain boundaries

### Phase 3: Advanced Features
- Multiple calendars per user
- Recurring events with full rule support
- Multi-language content
- Enhanced mobile experience
- Preparation for domain isolation and containerization
- Testing of domain-specific scaling

### Phase 4: Community Tools
- Aggregation features
- Improved discovery
- Enhanced embedding options
- Community curation tools
- Optional microservices deployment model
- Container orchestration support for high-demand instances

## Success Metrics

- Number of active instances in federation
- Events created per instance
- Cross-instance follows
- User retention rate
- Community calendar adoption
- Mobile vs desktop usage

## Appendix

### Terminology
- **Federation**: The system allowing different Pavillion instances to communicate and share data
- **Instance**: A single installation of Pavillion software
- **Calendar**: A collection of events belonging to a user or organization
- **Event**: A scheduled occurrence with details like time, place, and description
- **Follow**: A subscription to events from another calendar