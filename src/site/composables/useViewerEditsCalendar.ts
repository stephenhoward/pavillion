import { inject, ref, watch, type Ref } from 'vue';

import CalendarService from '@/site/service/calendar';

/**
 * Whether the signed-in visitor is known to own or edit a calendar.
 *
 * Defaults to false and only becomes true once an authenticated lookup
 * positively confirms membership, so callers that hide a control on true fail
 * open. Anonymous visitors (no `authn`, or no unexpired token) make no request.
 * The lookup is never awaited by the page: an error, or a request that never
 * settles, leaves the answer false.
 *
 * @param getUrlName - the calendar's urlName, or null/undefined until loaded
 */
export function useViewerEditsCalendar(getUrlName: () => string | null | undefined): Ref<boolean> {
  const viewerEdits = ref(false);
  const authn = inject<{ isLoggedIn: () => boolean } | null>('authn', null);

  if (!authn) {
    return viewerEdits;
  }

  let requested = false;
  watch(getUrlName, (urlName) => {
    if (!urlName || requested || !authn.isLoggedIn()) {
      return;
    }
    requested = true;
    new CalendarService().listEditableCalendarUrlNames()
      .then((urlNames) => {
        viewerEdits.value = urlNames.includes(urlName);
      })
      .catch(() => {
        viewerEdits.value = false;
      });
  }, { immediate: true });

  return viewerEdits;
}
