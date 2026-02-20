/**
 * Federation Test API Helpers
 *
 * This file provides helper functions for programmatic test data setup
 * via direct API calls. These bypass the UI to quickly set up test scenarios.
 *
 * All functions use fetch() to make HTTP requests to the Pavillion API.
 * They require an authentication token obtained via getToken().
 *
 * Usage pattern:
 *   1. Get a token: const token = await getToken(INSTANCE_ALICE, email, password)
 *   2. Create test data: const calendar = await createCalendar(INSTANCE_ALICE, token, {...})
 *   3. Perform federation action: await followCalendar(INSTANCE_BOB, token, ...)
 */

import { InstanceConfig } from './instances';
import https from 'https';

// Create an HTTPS agent that accepts self-signed certificates for local testing
const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * Calendar data for API creation
 */
export interface CalendarData {
  /** URL-friendly name for the calendar (e.g., 'community_events') */
  urlName: string;
  /** Display content with language-specific names */
  content?: {
    en?: {
      name: string;
    };
  };
}

/**
 * Event data for API creation
 */
export interface EventData {
  /** ID of the calendar this event belongs to */
  calendarId: string;
  /** Event content with language-specific details */
  content?: {
    en?: {
      title: string;
      description?: string;
    };
  };
  /** Start time in ISO 8601 format */
  startTime: string;
  /** End time in ISO 8601 format */
  endTime: string;
  /** Location information */
  location?: {
    name?: string;
    address?: string;
  };
}

/**
 * Calendar response from the API
 */
export interface CalendarResponse {
  id: string;
  urlName: string;
  content: Record<string, { name: string }>;
}

/**
 * Event response from the API
 */
export interface EventResponse {
  id: string;
  calendarId: string;
  content: Record<string, { title: string; description?: string }>;
  startTime: string;
  endTime: string;
}

/**
 * Follow relationship - represents a calendar the local calendar is following
 * The calendarActorId is in format: calendar_name@domain
 */
export interface FollowResponse {
  id: string;
  calendarActorId: string;
  calendarId: string;
  repostPolicy: string;
}

/**
 * Follower relationship - represents a calendar following the local calendar
 * The calendarActorId is in format: calendar_name@domain
 */
export interface FollowerResponse {
  id: string;
  calendarActorId: string;
  calendarId: string;
}

/**
 * Get an authentication token for API calls
 *
 * Authenticates with the Pavillion API and returns a JWT token that
 * can be used for subsequent authenticated API calls.
 *
 * Note: The Pavillion API uses /api/auth/v1/login for authentication,
 * which is separate from the /api/v1/ prefix used for other API routes.
 *
 * @param instance - The instance configuration to authenticate against
 * @param email - Email address of the user
 * @param password - Password of the user
 * @returns JWT token string
 * @throws Error if authentication fails
 *
 * @example
 * const token = await getToken(INSTANCE_ALICE, 'admin@pavillion.dev', 'admin');
 */
export async function getToken(
  instance: InstanceConfig,
  email: string,
  password: string,
): Promise<string> {
  // Pavillion uses /api/auth/v1/login for authentication
  const response = await fetch(`${instance.baseUrl}/api/auth/v1/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
    // @ts-ignore - agent is not in the TypeScript types but works at runtime
    agent: httpsAgent,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to authenticate: ${response.status} ${errorText}`);
  }

  const token = await response.text();
  return token;
}

/**
 * Create a calendar on the specified instance
 *
 * Creates a new calendar using the Pavillion API. The calendar will
 * have an ActivityPub actor that can be discovered via WebFinger.
 *
 * @param instance - The instance to create the calendar on
 * @param token - Authentication token from getToken()
 * @param calendarData - Calendar configuration
 * @returns The created calendar data
 * @throws Error if creation fails
 *
 * @example
 * const calendar = await createCalendar(INSTANCE_ALICE, token, {
 *   urlName: 'community_events',
 *   content: { en: { name: 'Community Events' } }
 * });
 */
export async function createCalendar(
  instance: InstanceConfig,
  token: string,
  calendarData: CalendarData,
): Promise<CalendarResponse> {
  const response = await fetch(`${instance.baseUrl}/api/v1/calendars`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(calendarData),
    // @ts-ignore - agent is not in the TypeScript types but works at runtime
    agent: httpsAgent,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create calendar: ${response.status} ${errorText}`);
  }

  const calendar = await response.json();

  // Wait for CalendarActor to be created asynchronously
  // The calendar.created event triggers CalendarActorEntity creation via event bus
  // CalendarActor creation includes RSA keypair generation which can take time
  // In real usage, there's enough time between calendar creation and federation operations
  // In tests, we need to wait for the async event handler to complete
  await new Promise(resolve => setTimeout(resolve, 2000));

  return calendar;
}

/**
 * Create an event on the specified calendar
 *
 * Creates a new event using the Pavillion API. When the calendar has
 * followers, this will trigger federation of the event to those followers.
 *
 * @param instance - The instance to create the event on
 * @param token - Authentication token from getToken()
 * @param eventData - Event configuration including calendarId
 * @returns The created event data
 * @throws Error if creation fails
 *
 * @example
 * const event = await createEvent(INSTANCE_ALICE, token, {
 *   calendarId: calendar.id,
 *   content: { en: { title: 'Community Meetup' } },
 *   startTime: '2025-02-01T18:00:00Z',
 *   endTime: '2025-02-01T20:00:00Z'
 * });
 */
export async function createEvent(
  instance: InstanceConfig,
  token: string,
  eventData: EventData,
): Promise<EventResponse> {
  const response = await fetch(`${instance.baseUrl}/api/v1/events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(eventData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create event: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Follow a remote calendar
 *
 * Makes the local calendar follow a remote calendar via ActivityPub.
 * This sends a Follow activity to the remote instance's inbox.
 *
 * @param instance - The local instance (the one doing the following)
 * @param token - Authentication token for the local instance
 * @param localCalendarId - ID of the local calendar that will follow
 * @param remoteCalendarId - Remote calendar identifier in format calendar@domain (e.g., 'community_events@alice.federation.local')
 * @throws Error if the follow operation fails
 *
 * @example
 * await followCalendar(
 *   INSTANCE_BOB,
 *   bobToken,
 *   bobCalendar.id,
 *   'community_events@alice.federation.local'
 * );
 */
export async function followCalendar(
  instance: InstanceConfig,
  token: string,
  localCalendarId: string,
  remoteCalendarId: string,
): Promise<void> {
  const response = await fetch(`${instance.baseUrl}/api/v1/social/follows`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      calendarId: localCalendarId,
      remoteCalendar: remoteCalendarId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to follow calendar: ${response.status} ${errorText}`);
  }
}

/**
 * Unfollow a remote calendar
 *
 * Makes the local calendar unfollow a remote calendar via ActivityPub.
 * This sends an Undo(Follow) activity to the remote instance's inbox.
 *
 * @param instance - The local instance (the one doing the unfollowing)
 * @param token - Authentication token for the local instance
 * @param followId - ID of the follow relationship to delete
 * @param localCalendarId - ID of the local calendar that is following
 * @param remoteCalendarId - Remote calendar identifier (calendar@domain format)
 * @throws Error if the unfollow operation fails
 *
 * @example
 * await unfollowCalendar(
 *   INSTANCE_BOB,
 *   bobToken,
 *   follow.id,
 *   bobCalendar.id,
 *   'community_events@alice.federation.local'
 * );
 */
export async function unfollowCalendar(
  instance: InstanceConfig,
  token: string,
  followId: string,
  localCalendarId: string,
  remoteCalendarId: string,
): Promise<void> {
  const response = await fetch(`${instance.baseUrl}/api/v1/social/follows/${encodeURIComponent(followId)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      calendarId: localCalendarId,
      remoteCalendar: remoteCalendarId,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to unfollow calendar: ${response.status} ${errorText}`);
  }
}

/**
 * Get the list of calendars the local calendar is following
 *
 * @param instance - The instance to query
 * @param token - Authentication token
 * @param calendarId - ID of the calendar to get follows for
 * @returns Array of follow objects with calendarActorId in format calendar@domain
 * @throws Error if the request fails
 */
export async function getFollows(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
): Promise<FollowResponse[]> {
  const response = await fetch(
    `${instance.baseUrl}/api/v1/social/follows?calendarId=${calendarId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get follows: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Get the list of calendars following the local calendar
 *
 * @param instance - The instance to query
 * @param token - Authentication token
 * @param calendarId - ID of the calendar to get followers for
 * @returns Array of follower objects with calendarActorId in format calendar@domain
 * @throws Error if the request fails
 */
export async function getFollowers(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
): Promise<FollowerResponse[]> {
  const response = await fetch(
    `${instance.baseUrl}/api/v1/social/followers?calendarId=${calendarId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get followers: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Get the feed of events from followed calendars
 *
 * @param instance - The instance to query
 * @param token - Authentication token
 * @param calendarId - ID of the calendar to get the feed for
 * @returns Feed response with events array
 * @throws Error if the request fails
 */
export async function getFeed(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
): Promise<{ events: Array<{ id: string; event_source_url?: string; content: Record<string, { title: string }> }>; hasMore: boolean }> {
  const response = await fetch(
    `${instance.baseUrl}/api/v1/social/feed?calendarId=${calendarId}`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get feed: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Update an event on the specified calendar
 *
 * Updates an existing event using the Pavillion API. When the calendar
 * has followers, this will trigger federation of the update to those followers.
 *
 * @param instance - The instance where the event exists
 * @param token - Authentication token from getToken()
 * @param eventId - ID of the event to update
 * @param eventData - Updated event data
 * @returns The updated event data
 * @throws Error if update fails
 */
export async function updateEvent(
  instance: InstanceConfig,
  token: string,
  eventId: string,
  eventData: Partial<EventData>,
): Promise<EventResponse> {
  const response = await fetch(`${instance.baseUrl}/api/v1/events/${encodeURIComponent(eventId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(eventData),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update event: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Get list of calendars for the authenticated user
 *
 * @param instance - The instance to query
 * @param token - Authentication token
 * @returns Array of calendar objects
 * @throws Error if the request fails
 */
export async function getCalendars(
  instance: InstanceConfig,
  token: string,
): Promise<CalendarResponse[]> {
  const response = await fetch(`${instance.baseUrl}/api/v1/calendars`, {
    headers: {
      'Authorization': `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get calendars: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Get events for a specific calendar
 *
 * @param instance - The instance to query
 * @param token - Authentication token
 * @param calendarId - ID of the calendar to get events for
 * @returns Response object (use .json() to get events array)
 * @throws Error if the request fails
 */
export async function getCalendarEvents(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
): Promise<Response> {
  return await fetch(
    `${instance.baseUrl}/api/v1/calendars/${calendarId}/events`,
    {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    },
  );
}

/**
 * Create a new account on the instance
 *
 * @param instance - The instance to create the account on
 * @param username - Username for the account
 * @param email - Email for the account
 * @returns Account data with generated password
 * @throws Error if account creation fails
 */
export async function createAccount(
  instance: InstanceConfig,
  username: string,
  email: string,
): Promise<{ id: string; username: string; email: string; password: string }> {
  // Generate a random password for the test account
  const password = `test-${Math.random().toString(36).substring(7)}`;

  const response = await fetch(`${instance.baseUrl}/api/v1/accounts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      username,
      email,
      password,
    }),
    // @ts-ignore - agent is not in the TypeScript types but works at runtime
    agent: httpsAgent,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create account: ${response.status} ${errorText}`);
  }

  const account = await response.json();
  return { ...account, password };
}

/**
 * Grant editor access to a user by email
 *
 * @param instance - The instance where the calendar exists
 * @param token - Authentication token for the calendar owner
 * @param calendarId - ID of the calendar to grant access to
 * @param editorEmail - Email of the user to grant editor access (can be federated email like user@instance.domain)
 * @returns Response object
 * @throws Error if granting access fails
 */
export async function grantEditorAccessByEmail(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
  editorEmail: string,
): Promise<Response> {
  return await fetch(
    `${instance.baseUrl}/api/v1/calendars/${calendarId}/editors`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        email: editorEmail,
      }),
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    },
  );
}

/**
 * Update auto-repost policy for an existing follow relationship
 *
 * @param instance - The instance where the follow relationship exists
 * @param token - Authentication token for the calendar owner
 * @param followId - ID of the follow relationship to update (full ActivityPub URL)
 * @param calendarId - ID of the local calendar
 * @param autoRepostOriginals - Whether to auto-repost original events
 * @param autoRepostReposts - Whether to auto-repost reposts
 * @returns Response object
 */
export async function updateFollowPolicy(
  instance: InstanceConfig,
  token: string,
  followId: string,
  calendarId: string,
  autoRepostOriginals: boolean,
  autoRepostReposts: boolean
): Promise<FollowResponse> {
  const response = await fetch(
    `${instance.baseUrl}/api/v1/social/follows/${encodeURIComponent(followId)}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        calendarId,
        autoRepostOriginals,
        autoRepostReposts,
      }),
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update follow policy: ${response.status} ${errorText}`);
  }

  return await response.json();
}

/**
 * Share an event to a calendar (creates an Announce activity)
 *
 * Makes the local calendar share/repost an event from the feed to its own calendar.
 * This is used to manually share events, similar to how auto-repost works automatically.
 *
 * @param instance - The instance where the calendar exists
 * @param token - Authentication token for the calendar owner
 * @param calendarId - ID of the calendar to share the event to
 * @param eventId - ID of the event to share (from feed)
 * @returns Response object
 * @throws Error if the share operation fails
 *
 * @example
 * const event = feed.events.find(e => e.content?.en?.title === 'Event Title');
 * await shareEvent(INSTANCE_ALPHA, token, calendar.id, event!.id);
 */
export async function shareEvent(
  instance: InstanceConfig,
  token: string,
  calendarId: string,
  eventId: string,
): Promise<Response> {
  const response = await fetch(
    `${instance.baseUrl}/api/v1/social/shares`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        calendarId,
        eventId,
      }),
      // @ts-ignore - agent is not in the TypeScript types but works at runtime
      agent: httpsAgent,
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to share event: ${response.status} ${errorText}`);
  }

  return response;
}
