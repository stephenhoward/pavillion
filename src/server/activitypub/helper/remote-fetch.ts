import axios from 'axios';
import { REMOTE_OBJECT_FETCH_TIMEOUT_MS } from '@/server/activitypub/constants';
import { validateUrlNotPrivate } from '@/server/activitypub/helper/ip-validation';

/**
 * User agent string for ActivityPub federation requests.
 */
const USER_AGENT = 'Pavillion ActivityPub Server';

/**
 * Accept header for ActivityPub requests.
 */
const ACTIVITYPUB_ACCEPT_HEADER = 'application/activity+json';

/**
 * Fetches a remote ActivityPub object by URI.
 *
 * This function performs an HTTP GET request to retrieve an ActivityPub object
 * from a remote server. It uses proper headers for ActivityPub content negotiation
 * and handles errors gracefully by returning null on failure.
 *
 * SECURITY: Validates that the URI does not point to private IP addresses
 * to prevent SSRF (Server-Side Request Forgery) attacks.
 *
 * @param uri - The URI of the remote ActivityPub object to fetch
 * @returns The parsed JSON object, or null if the fetch fails
 *
 * @example
 * ```typescript
 * const event = await fetchRemoteObject('https://remote.example/events/123');
 * if (event) {
 *   console.log('Fetched event:', event.name);
 * }
 * ```
 */
export async function fetchRemoteObject(uri: string): Promise<Record<string, unknown> | null> {
  try {
    // SECURITY: Validate that the URL does not point to a private IP address
    // This prevents SSRF attacks where an attacker could probe internal networks
    try {
      await validateUrlNotPrivate(uri);
    }
    catch (error) {
      if (error instanceof Error) {
        console.error(`Security: Blocked request to private IP for URI ${uri}: ${error.message}`);
      }
      return null;
    }

    const response = await axios.get(uri, {
      headers: {
        'Accept': ACTIVITYPUB_ACCEPT_HEADER,
        'User-Agent': USER_AGENT,
      },
      timeout: REMOTE_OBJECT_FETCH_TIMEOUT_MS,
    });

    if (response.status !== 200) {
      console.error(`Failed to fetch remote object from ${uri}, status: ${response.status}`);
      return null;
    }

    return response.data;
  }
  catch (error) {
    // Log the error but return null to allow graceful handling
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        console.error(`Timeout fetching remote object from ${uri}`);
      }
      else if (error.response) {
        console.error(`HTTP error fetching remote object from ${uri}: ${error.response.status}`);
      }
      else if (error.request) {
        console.error(`Network error fetching remote object from ${uri}: ${error.message}`);
      }
      else {
        console.error(`Error fetching remote object from ${uri}: ${error.message}`);
      }
    }
    else {
      console.error(`Unexpected error fetching remote object from ${uri}:`, error);
    }
    return null;
  }
}
