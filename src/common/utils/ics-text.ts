/**
 * iCalendar (RFC 5545) text helpers shared by the site's single-occurrence
 * download (`ics-generator.ts`, browser only) and the server's calendar
 * export. Pure string functions: nothing here touches the DOM, so the server
 * may import this module where it may not import `ics-generator.ts`.
 */

import type { EventLocation } from '@/common/model/location';

/**
 * Escapes text for ICS field values per RFC 5545.
 */
export function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n/g, '\\n')
    .replace(/\r/g, '\\n')
    .replace(/\n/g, '\\n');
}

/**
 * Folds long ICS lines at 75 octets per RFC 5545 Section 3.1.
 * Folds on character boundaries to avoid splitting multi-byte UTF-8 sequences.
 */
export function foldLine(line: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(line);
  const maxLen = 75;

  if (bytes.length <= maxLen) return line;

  const parts: string[] = [];
  let remaining = line;
  let isFirst = true;

  while (remaining.length > 0) {
    const limit = isFirst ? maxLen : maxLen - 1; // account for leading space on continuation lines
    let charCount = 0;
    let byteCount = 0;

    for (const char of remaining) {
      const charBytes = encoder.encode(char).length;
      if (byteCount + charBytes > limit) break;
      byteCount += charBytes;
      charCount += char.length; // handle surrogate pairs
    }

    if (charCount === 0) charCount = 1; // always make progress

    const chunk = remaining.substring(0, charCount);
    parts.push(isFirst ? chunk : ' ' + chunk);
    remaining = remaining.substring(charCount);
    isFirst = false;
  }

  return parts.join('\r\n');
}

/**
 * Formats a location into a single ICS LOCATION string:
 * `Place, Space, address, City, ST 12345`, each part only when present.
 *
 * @param location - The place
 * @param spaceName - The name of the room or area within the place, already
 *   resolved to one language by the caller
 */
export function formatLocation(location: EventLocation, spaceName?: string): string {
  const parts: string[] = [];
  if (location.name) parts.push(location.name);
  if (spaceName) parts.push(spaceName);
  if (location.address) parts.push(location.address);
  if (location.city) {
    let cityLine = location.city;
    if (location.state) cityLine += `, ${location.state}`;
    if (location.postalCode) cityLine += ` ${location.postalCode}`;
    parts.push(cityLine);
  }
  return parts.join(', ');
}
