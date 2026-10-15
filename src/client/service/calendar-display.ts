import type { Calendar } from '@/common/model/calendar';

/**
 * The name the client shows for one of the account's calendars: its English
 * name, or its url name when that is blank. One rule for headings, the
 * calendar switcher and the settings label.
 */
export function calendarDisplayName(calendar: Calendar): string {
  return calendar.content('en').name || calendar.urlName;
}
