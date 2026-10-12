# Product Mission

> Last Updated: 2025-07-29
> Version: 1.0.0

## Pitch

Pavillion is a federated events calendar system that helps organizations and communities share their events publicly while enabling community curators to aggregate and manage events from multiple sources. By providing a decentralized, privacy-focused platform, Pavillion makes it simple for cities, chambers of commerce, tourism boards, and community organizations to create accessible community calendars. It is primarily designed to be infrastructure to improve the prosperity and wellbeing of a local community.

## Users

### Primary Customers

- **Event Organizers**: Organizations, nonprofits, businesses, and individuals who need to share their events with the public and manage event details, recurring schedules, and multilingual content.
- **Community Curators**: Cities, chambers of commerce, tourism boards, and community organizations who aggregate and curate events from multiple sources to create comprehensive community calendars.
- **Instance Administrators**: Technical users who manage Pavillion servers, configure federation policies, and maintain system health for their communities.

### User Personas

**Event Attendee** (any age)
- **Role:** Community Member, Event Participant
- **Context:** Looking for local events to attend without wanting to create accounts or provide personal information
- **Pain Points:** Hard to find comprehensive event listings, concerns about privacy and data collection, barriers to accessing event information
- **Goals:** Easily discover relevant local events, access information without registration, view events in preferred language

**Community Event Organizer** (25-65 years old)
- **Role:** Nonprofit Coordinator, Business Owner, Community Leader
- **Context:** Needs to promote events to increase attendance and community engagement
- **Pain Points:** Limited reach with current tools, difficulty managing recurring events, challenge of multilingual content management
- **Goals:** Increase event visibility, manage events efficiently, reach diverse community members, coordinate with other organizers

**Community Curator** (30-60 years old)
- **Role:** City Events Coordinator, Chamber of Commerce Director, Tourism Board Manager
- **Context:** Responsible for promoting community activities and supporting local economic development
- **Pain Points:** Fragmented event information across multiple platforms, manual aggregation processes, difficulty maintaining up-to-date listings
- **Goals:** Create comprehensive community calendars, support local organizations, reduce manual work through federation

**Instance Administrator** (25-50 years old)
- **Role:** Systems Administrator, Community Tech Lead
- **Context:** Managing technical infrastructure while supporting community organizations
- **Pain Points:** Complex federation management, balancing openness with security, system maintenance overhead
- **Goals:** Maintain reliable service, configure appropriate federation policies, support community needs

## The Problem

### Fragmented Event Discovery

Event information is scattered across multiple platforms (Facebook, Eventbrite, individual websites), making it difficult for community members to discover all available local activities. This fragmentation reduces event attendance and weakens community connections.

**Our Solution:** Pavillion provides federated event aggregation that allows organizations to maintain their own calendars while enabling community curators to create comprehensive, unified views.

### Privacy vs. Accessibility Trade-offs

Most event platforms require user registration and collect personal data even for basic event viewing, creating barriers to access while compromising user privacy.

**Our Solution:** Pavillion prioritizes anonymous access to public event information with account requirements only for organizers and curators, not attendees.

### Limited Community Control

Event platforms are typically controlled by large corporations with limited customization options and no local community governance over content policies or federation relationships.

**Our Solution:** Pavillion enables local instances with community-controlled governance, federation policies, and content moderation aligned with local values and needs.

### Inadequate Multilingual Support

Many communities are multilingual, but most event platforms have poor support for multiple languages, limiting accessibility for diverse community members.

**Our Solution:** Pavillion provides comprehensive multilingual content support with language-specific event details and interface translations.

## Differentiators

### Decentralized Federation with Local Control

Unlike centralized platforms like Facebook Events or Eventbrite, Pavillion provides ActivityPub-based federation that allows communities to maintain their own instances while sharing events across a network. This results in community ownership of data and policies while maintaining broad reach and discoverability.

### Privacy-First Design for Public Content

Unlike most event platforms that require user accounts for basic browsing, Pavillion provides full anonymous access to public event information with no tracking or data collection for attendees. This results in broader community access and increased trust from privacy-conscious users.

### Economic Gardening Focus

Unlike commercial event platforms focused on ticket sales and advertising revenue, Pavillion is designed specifically to support local economic development and community building through the "economic gardening" approach. This results in features and policies that prioritize community benefit over profit extraction.

## Key Features

### Core Features

- **Federated Event Sharing:** Organizations can share events across multiple Pavillion instances using ActivityPub protocol
- **Anonymous Public Access:** Event attendees can browse and discover events without creating accounts or providing personal information
- **Multilingual Content Support:** Events can be created and displayed in multiple languages with full i18n support
- **Recurring Event Management:** Comprehensive support for complex recurring event patterns using RRule
- **Media Attachments:** Rich event descriptions with image uploads and media management
- **Location Management:** Structured location data with reusable venue information
- **Public Calendar Embeds:** Embeddable calendar widgets for third-party websites

### Collaboration Features

- **Multi-Editor Calendars:** Multiple users can be granted editing permissions on calendars they don't own
- **Federation Management:** Instance administrators can configure federation policies and relationships
- **Content Moderation:** Tools for moderating federated content based on community standards
- **Category Systems:** Flexible event categorization with mapping between federated instances
- **Auto-Repost Configuration:** Configurable automatic reposting policies based on trust levels
- **Editor Invitations:** Calendar owners can invite others to become editors and contributors