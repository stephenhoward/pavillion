import axios from 'axios';

/**
 * Stored email structure matching the server-side StoredEmail interface.
 */
export interface StoredEmail {
  id: string;
  date: string;
  from: string;
  to: string | string[];
  subject: string;
  text: string;
  html?: string;
  raw: string;
}

/**
 * Get the most recently sent email from the test server.
 *
 * @param baseURL - Base URL of the test server (e.g., http://localhost:3124)
 * @returns The most recent email, or null if no emails have been sent
 */
export async function getLatestEmail(baseURL: string): Promise<StoredEmail | null> {
  try {
    const response = await axios.get(`${baseURL}/api/test/emails/latest`);
    return response.data.email;
  }
  catch (error: any) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Find all emails sent to a specific recipient.
 *
 * @param baseURL - Base URL of the test server
 * @param email - Recipient email address to search for
 * @returns Array of matching emails
 */
export async function findEmailsByRecipient(baseURL: string, email: string): Promise<StoredEmail[]> {
  const response = await axios.get(`${baseURL}/api/test/emails`, {
    params: { recipient: email },
  });
  return response.data.emails;
}

/**
 * Get all stored emails from the test server.
 *
 * @param baseURL - Base URL of the test server
 * @returns Array of all stored emails
 */
export async function getAllEmails(baseURL: string): Promise<StoredEmail[]> {
  const response = await axios.get(`${baseURL}/api/test/emails`);
  return response.data.emails;
}

/**
 * Clear all stored emails on the test server.
 * Useful for resetting state between test scenarios.
 *
 * @param baseURL - Base URL of the test server
 */
export async function clearEmails(baseURL: string): Promise<void> {
  await axios.delete(`${baseURL}/api/test/emails`);
}

/**
 * Extract a URL or link from an email body that matches a given pattern.
 *
 * Searches the text body first, then falls back to the HTML body.
 * The pattern should be a RegExp with a capture group for the URL/token.
 *
 * @param email - The stored email to extract from
 * @param pattern - RegExp pattern with a capture group for the desired value
 * @returns The first captured group match, or null if not found
 *
 * @example
 * // Extract a password reset link
 * const resetLink = extractLinkFromEmail(email, /href="([^"]*reset-password[^"]*)"/);
 *
 * // Extract a reset token from the URL
 * const token = extractLinkFromEmail(email, /reset-password\?token=([a-zA-Z0-9-]+)/);
 */
export function extractLinkFromEmail(email: StoredEmail, pattern: RegExp): string | null {
  // Try text body first
  if (email.text) {
    const textMatch = email.text.match(pattern);
    if (textMatch && textMatch[1]) {
      return textMatch[1];
    }
  }

  // Fall back to HTML body
  if (email.html) {
    const htmlMatch = email.html.match(pattern);
    if (htmlMatch && htmlMatch[1]) {
      return htmlMatch[1];
    }
  }

  return null;
}

/**
 * Wait for an email to arrive for a specific recipient, with polling.
 *
 * Useful when an action triggers an asynchronous email send and you need
 * to wait for it to be stored before querying.
 *
 * @param baseURL - Base URL of the test server
 * @param recipientEmail - Email address to watch for
 * @param options - Polling options
 * @returns The first email found for the recipient
 * @throws Error if no email arrives within the timeout
 */
export async function waitForEmail(
  baseURL: string,
  recipientEmail: string,
  options: { timeout?: number; interval?: number; minCount?: number } = {},
): Promise<StoredEmail> {
  const { timeout = 10000, interval = 250, minCount = 1 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    const emails = await findEmailsByRecipient(baseURL, recipientEmail);
    if (emails.length >= minCount) {
      return emails[emails.length - 1];
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error(
    `No email arrived for ${recipientEmail} within ${timeout}ms`,
  );
}
