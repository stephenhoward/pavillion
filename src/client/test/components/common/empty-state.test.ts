import { describe, it, expect, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';

import EmptyState from '@/client/components/common/empty_state.vue';
import DocLink from '@/client/components/common/doc-link.vue';
import { mountComponent } from '@/client/test/lib/vue';
import type { GuideRef } from '@/client/service/docs';

const GUIDE: GuideRef = { slug: 'guides/calendar-owners/quickstart', key: 'quickstart' };

const routes: RouteRecordRaw[] = [{ path: '/', component: {}, name: 'calendars' }];

const sheetStub = {
  Sheet: {
    template: '<div role="dialog"><slot /></div>',
    props: ['title'],
    emits: ['close'],
  },
};

const mountEmpty = async (props: Record<string, unknown>) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push('/');
  await router.isReady();
  return mountComponent(EmptyState, router, { props, stubs: sheetStub });
};

describe('EmptyState', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('renders the title and no DocLink when no guide is provided', async () => {
    const wrapper = await mountEmpty({ title: 'Nothing here' });
    currentWrapper = wrapper;

    expect(wrapper.find('h2').text()).toBe('Nothing here');
    expect(wrapper.findComponent(DocLink).exists()).toBe(false);
  });

  it('renders a DocLink for the guide and never an external doc anchor', async () => {
    const wrapper = await mountEmpty({ title: 'Empty', guide: GUIDE });
    currentWrapper = wrapper;

    const docLink = wrapper.findComponent(DocLink);
    expect(docLink.exists()).toBe(true);
    expect(docLink.props('guide')).toEqual(GUIDE);
    expect(wrapper.find('a[target="_blank"]').exists()).toBe(false);
  });

  it('uses the guide i18n label as DocLink text when no guideLabel is given', async () => {
    const wrapper = await mountEmpty({ title: 'Empty', guide: GUIDE });
    currentWrapper = wrapper;

    expect(wrapper.findComponent(DocLink).text()).toContain('Quickstart');
  });

  it('uses the custom guideLabel as DocLink text when provided', async () => {
    const wrapper = await mountEmpty({ title: 'Empty', guide: GUIDE, guideLabel: 'How to create a calendar' });
    currentWrapper = wrapper;

    expect(wrapper.findComponent(DocLink).text()).toContain('How to create a calendar');
  });
});
