# Product Roadmap

> Last Updated: 2025-11-09
> Version: 2.1.0
> Status: Active Development

## Table of Contents

1. [Phase 0: Already Completed](#phase-0-already-completed)
2. [Phase 1: Complete Single-User Experience](#phase-1-complete-single-user-experience-2-3-weeks)
3. [Phase 2: Enhanced Public Calendar Experience](#phase-2-enhanced-public-calendar-experience-3-4-weeks)
4. [Phase 3: Embeddable Widgets & Integration](#phase-3-embeddable-widgets--integration-2-3-weeks)
5. [Phase 4: Content Moderation & Trust](#phase-4-content-moderation--trust-4-6-weeks)
6. [Phase 5: Performance & Scalability](#phase-5-performance--scalability-3-4-weeks)
7. [Development Guidelines](#development-guidelines)

## Phase 0: Already Completed

The following features have been implemented and are functional:

- [x] **User Authentication System** - Complete login/logout, password reset, JWT-based API authentication `L`
- [x] **Account Management** - User registration, invitations, applications, account approval workflows `L`
- [x] **Basic Calendar Management** - Calendar creation, editing, URL naming, multi-editor collaboration system `L`
- [x] **Event Creation & Management** - Full event CRUD operations with rich content support, media attachments `L`
- [x] **Event Scheduling System** - Complex recurring events using RRule, event instances, timezone handling `L`
- [x] **Location Management** - Reusable venue data, structured location information `M`
- [x] **Media Management** - Image uploads, S3-compatible storage, single media attachment per event `M`
- [x] **Multilingual Support** - Full i18n infrastructure for client and server, translation management `L`
- [x] **ActivityPub Federation** - **COMPREHENSIVE IMPLEMENTATION** including follow/unfollow, event sharing, auto-repost policies, inbox/outbox processing, WebFinger discovery, HTTP signatures `XL`
- [x] **Public Calendar Views** - Anonymous access to calendar content via site app `M`
- [x] **Admin Interface** - Instance administration, user management, federation settings `L`
- [x] **Development Infrastructure** - Complete testing framework, linting, build process, development workflows `L`
- [x] **Event Categories System** - Category creation, management, content translation support, **backend complete with assignment APIs**, frontend category selector for event creation/editing `L`

## Phase 1: Complete Single-User Experience (2-3 weeks)

**Goal:** Complete the core single-user calendar management experience with filtering, organization, and discovery tools
**Success Criteria:** Calendar owners can efficiently organize events with categories, users can filter and find events easily

### Must-Have Features

- [x] **Event Category Filtering & Display** - Users can filter events by category in calendar views `M`
  - Category-based event filtering in backend (support multiple category queries)
  - Category filter UI in calendar views (multi-select interface)
  - Category display in event listings (show assigned categories)
  - Category-based visual organization for event management
- [x] **Enhanced Event Management Interface** - Improved event organization and bulk operations `M`
  - Bulk event deletion (select multiple events and delete them)
  - Event search within calendar (by title, description, category)
  - Bulk category assignment for selected events
  - Individual event duplication functionality for template-based creation
- [x] **Category Management Enhancements** - Advanced category organization tools `S`
  - Category deletion with event migration options
  - Category merging functionality (consolidate multiple categories)
  - Category usage statistics and event counts
- [ ] **Calendar Organization Tools** - Better calendar navigation and management `M`
  - Calendar archive/active status management
  - Calendar templates for quick setup
  - Calendar duplication with event templates
  - Enhanced calendar settings and configuration options

### Should-Have Features

- [ ] **Advanced Location Management** - Enhanced location features `S`
  - Location autocomplete from previously used venues
  - Location validation and standardization
  - Bulk location updates across events
- [ ] **Event Import/Export** - Data portability features `M`
  - Import events from iCal, CSV formats
  - Export calendar data to standard formats
  - Backup and restore functionality

### Dependencies

- Existing event creation and category systems
- Current calendar management infrastructure

## Phase 2: Enhanced Public Calendar Experience (3-4 weeks)

**Goal:** Improve public discovery and viewing experience for anonymous users visiting calendars
**Success Criteria:** Public users can easily find, filter, and view events on any public calendar

### Must-Have Features

- [ ] **Enhanced Public Calendar Views** - Better layout and presentation for public viewing `M`
  - Improved month/week/day view layouts with responsive design
  - Event density management for days with many events
  - Event preview popups and enhanced event detail pages
  - Mobile-optimized navigation and viewing experience
- [ ] **Public Event Search & Filtering** - Discovery tools for public users `L`
  - Text-based event search (by title, description, location)
  - Category-based filtering with multi-select interface
  - Date range filtering and navigation
  - Location-based filtering options
  - Combined filter interface with URL parameter support
- [ ] **Calendar Discovery & Navigation** - Help users find and explore calendars `M`
  - Public calendar directory/listing page
  - Calendar metadata display (descriptions, categories, stats)
  - Calendar search across public instances
  - Featured calendar promotion system
  - Recent events and upcoming events highlights

### Should-Have Features

- [ ] **Event Sorting Options** - Sortable event lists for better organization `S`
  - Sort by date (ascending/descending)
  - Sort by title (alphabetical)
  - Sort by category
- [ ] **Enhanced Event Detail Views** - Rich public event presentation `M`
  - Dedicated event detail pages with social sharing
  - Event image galleries and enhanced media display
  - Location information with map integration
  - Related events suggestions
- [ ] **Public Calendar Analytics** - Basic usage insights for calendar owners `S`
  - View counts and engagement metrics
  - Popular events tracking
  - Traffic source analysis

### Dependencies

- Existing public site app infrastructure
- Event categories system
- Search infrastructure

## Phase 3: Embeddable Widgets & Integration (2-3 weeks)

**Goal:** Enable organizations to embed calendars in external websites and integrate with other platforms
**Success Criteria:** Organizations can easily embed interactive calendars on their websites with customizable appearance

### Must-Have Features

- [ ] **Widget System Architecture** - Embeddable calendar framework `L`
  - Widget-specific API endpoints with CORS support
  - Lightweight widget rendering without external dependencies
  - Configurable widget parameters (size, filters, themes)
  - Widget security and rate limiting
- [ ] **Embeddable Widget Library** - JavaScript library for external sites `M`
  - Standalone widget JavaScript with minimal footprint
  - Multiple widget types (full calendar, event list, upcoming events)
  - Responsive widget layouts that adapt to container size
  - Simple embedding with just a script tag and configuration
- [ ] **Widget Customization Interface** - Admin tools for widget configuration `M`
  - Widget customization UI for calendar owners
  - Theme and styling options (colors, fonts, layout)
  - Widget preview and testing environment
  - Embed code generation with copy-to-clipboard
  - Widget analytics and usage tracking

### Should-Have Features

- [ ] **Advanced Widget Features** - Enhanced embedding capabilities `M`
  - Custom CSS injection for advanced styling
  - Event click-through tracking and analytics
  - Widget interaction callbacks for parent site
  - Multiple calendar aggregation widgets
- [ ] **Third-Party Integrations** - Sync with external platforms `L`
  - iCal feed generation for calendar subscriptions
  - Google Calendar sync/export functionality
  - Social media integration for event promotion

### Dependencies

- Public calendar API endpoints
- Event filtering and search functionality

## Phase 4: Content Moderation & Trust (4-6 weeks)

**Goal:** Implement comprehensive content moderation tools and trust-based federation policies
**Success Criteria:** Administrators can moderate federated content and configure auto-repost policies based on trust levels

### Must-Have Features

- [ ] **Federation Trust Levels** - Configure trust relationships between instances for automated content policies `L`
  - Instance trust level configuration (trusted, neutral, blocked)
  - Auto-repost policy management based on trust levels
  - Cross-instance reputation tracking
  - Trust-based content filtering rules
- [ ] **Content Moderation Interface** - Review and moderate incoming federated events with approval/rejection workflows `L`
  - Moderation queue for incoming federated content
  - Event approval/rejection workflows with reasoning
  - Batch moderation operations for efficiency
  - Content preview and source instance information
- [ ] **Moderation Audit Log** - Track all moderation decisions with reasoning and administrator attribution `M`
  - Complete audit trail of moderation actions
  - Moderation decision history and appeals process
  - Administrator action attribution and accountability
  - Exportable moderation reports
- [ ] **Blocked Content Management** - Manage blocked instances, users, and content with detailed reporting `M`
  - Instance-level blocking and filtering
  - User/calendar blocking across federation
  - Content pattern blocking (keywords, categories)
  - Block list management and sharing

### Should-Have Features

- [ ] **Content Flagging System** - Allow community reporting of inappropriate content with review workflows `L`
  - Public content flagging interface for calendar visitors
  - Email verification for anonymous reports
  - Tiered review process (calendar owner → admin)
  - Flag management and resolution tracking
- [ ] **Federated Moderation Signals** - Share moderation decisions with trusted peer instances `L`
  - Moderation decision broadcasting to trusted instances
  - Collaborative moderation networks
  - Shared reputation and trust metrics

### Dependencies

- Existing ActivityPub federation infrastructure
- Admin interface components
- Public calendar viewing system

## Phase 5: Performance & Scalability (3-4 weeks)

**Goal:** Optimize performance for high-traffic instances and large-scale federation
**Success Criteria:** System handles 10,000+ events and 100+ federated instances efficiently

### Must-Have Features

- [ ] **Database Optimization** - Query optimization, indexing strategy, connection pooling `L`
  - Optimized database indexes for common query patterns
  - Connection pooling and query performance monitoring
  - Database schema optimization for large datasets
  - Efficient pagination for large event lists
- [ ] **Caching Layer** - Redis-based caching for frequently accessed data and API responses `L`
  - API response caching for public endpoints
  - Event and calendar data caching
  - Session and authentication caching
  - Cache invalidation strategies
- [ ] **Background Job Processing** - Queue system for federation activities, email sending, and heavy operations `L`
  - ActivityPub message processing queues
  - Email delivery queue system
  - Media processing and optimization queues
  - Scheduled task management (recurring events, cleanup)
- [ ] **API Rate Limiting** - Protect against abuse with configurable rate limiting per endpoint `M`
  - Per-endpoint rate limiting configuration
  - IP-based and user-based rate limiting
  - Federation-specific rate limiting
  - Rate limit monitoring and alerting

### Should-Have Features

- [ ] **CDN Integration** - Optimize media delivery and static asset performance `M`
  - Image and media CDN integration
  - Static asset optimization and delivery
  - Geographic content distribution
- [ ] **Monitoring & Alerting** - System health monitoring with alerts for administrators `L`
  - Application performance monitoring
  - Database performance tracking
  - Federation health monitoring
  - Automated alerting for system issues
- [ ] **Performance Metrics** - Detailed performance tracking and reporting dashboard `M`
  - API response time tracking
  - User engagement metrics
  - Federation activity monitoring
  - Resource usage analytics

### Dependencies

- Production deployment environment
- Load testing infrastructure
- Monitoring tools integration

## Development Guidelines

### Phase Progression
- **Single-User First**: Complete individual calendar management before multi-user features
- **Public Experience**: Enhance public viewing before advanced federation features
- **Core Utility**: Prioritize embeddable widgets over complex moderation systems
- **Performance**: Optimize for scale only after core features are stable
- Complete all Must-Have features before moving to next phase
- Should-Have features can be moved to later phases if needed
- Each phase should result in a deployable, stable system

### Priority Rationale
1. **Phase 1 (Single-User)**: Complete the core value proposition for individual users
2. **Phase 2 (Public Experience)**: Essential for calendar service utility to general public
3. **Phase 3 (Embeddable Widgets)**: Key differentiator providing immediate organizational value
4. **Phase 4 (Content Moderation)**: Important for federation health but not blocking core utility
5. **Phase 5 (Performance)**: Essential for scale but can be incremental

### Effort Scale
- **XS**: 1 day
- **S**: 2-3 days
- **M**: 1 week
- **L**: 2 weeks
- **XL**: 3+ weeks

### Current Implementation Status

**✅ Fully Functional:**
- Complete event creation and management with media attachments
- Comprehensive ActivityPub federation (follow, share, auto-repost policies)
- Calendar collaboration with editor permissions
- Event categories (backend complete, frontend assignment working)
- Public calendar viewing for anonymous users
- Multi-language content support throughout system
- Admin interface for user and instance management
- Event search with URL parameter persistence (title, description, category)
- Bulk event selection and operations (delete, category assignment)
- Event duplication functionality for template-based creation

**⚠️ Needs Completion for Phase 1:**
- Calendar template and duplication features (Calendar Organization Tools)

**📋 Implementation Notes:**
- ActivityPub federation is production-ready with comprehensive feature set
- Event categories system has complete backend API with frontend filtering UI
- Event search functionality complete with URL bookmarking support
- Bulk operations framework in place and extensible for future operations
- Public site app exists but needs enhanced search and filtering capabilities
- Widget system needs to be built from scratch for Phase 3
- Content moderation system needs implementation for Phase 4

This roadmap prioritizes completing the single-user experience before expanding to advanced multi-user and federation features, ensuring each user gets maximum value from their individual calendar management before adding collaborative and social features.
