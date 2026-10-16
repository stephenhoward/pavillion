import { describe, it, expect, beforeEach } from 'vitest';
import { createPinia, setActivePinia, Pinia } from 'pinia';
import { createMemoryHistory, createRouter } from 'vue-router';
import { mountComponent } from '@/client/test/lib/vue';
import FollowListItem from '@/client/components/logged_in/feed/follow_list_item.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';

const follow = {
  id: 'follow-1',
  calendarActorId: 'events@remote.example',
  calendarActorUuid: 'actor-uuid-1',
  calendarId: 'cal-123',
  autoRepostOriginals: false,
  autoRepostReposts: false,
};

describe('FollowListItem category-mappings link', () => {
  let pinia: Pinia;

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
  });

  function mountItem() {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: {} },
        { path: '/feed/:calendar/following/:actorId/category-mappings', component: {}, name: 'calendar_category_mappings' },
      ],
    });
    return mountComponent(FollowListItem, router, { pinia, props: { follow } });
  }

  it('links to the mappings page under the receiving calendar\'s feed', () => {
    useCalendarStore().setCalendarInfos([new CalendarInfo(new Calendar('cal-123', 'cal-name'), 'owner')]);

    const link = mountItem().find('a.mappings-link');

    expect(link.attributes('href')).toBe('/feed/cal-name/following/actor-uuid-1/category-mappings');
  });

  it('omits the link when the receiving calendar is not in the store', () => {
    const link = mountItem().find('a.mappings-link');

    expect(link.exists()).toBe(false);
  });
});
