import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { BookOpenText } from 'lucide-vue-next';

import DocLink from '@/client/components/common/doc-link.vue';
import HelpPanel from '@/client/components/common/help-panel.vue';
import { mountComponent } from '@/client/test/lib/vue';
import type { GuideRef, Audience } from '@/client/service/docs';

const GUIDE: GuideRef = { slug: 'guides/calendar-owners/quickstart', key: 'quickstart' };

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'calendars' },
  { path: '/federation', component: {}, name: 'federation' },
];

// Stub Sheet so happy-dom does not need HTMLDialogElement.showModal().
// HelpPanel still mounts, so its props remain assertable.
const sheetStub = {
  Sheet: {
    template: '<div role="dialog"><slot /></div>',
    props: ['title'],
    emits: ['close'],
  },
};

const Harness = defineComponent({
  props: {
    guide: { type: Object, required: true },
    audience: { type: String, default: undefined },
  },
  setup(props) {
    return () => h(DocLink, { guide: props.guide, audience: props.audience }, () => 'Read the guide');
  },
});

const mountDocLink = async (
  props: { guide: GuideRef; audience?: Audience } = { guide: GUIDE },
  routeName = 'calendars',
) => {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  await router.push({ name: routeName });
  await router.isReady();
  return mountComponent(Harness, router, { props, stubs: sheetStub });
};

describe('DocLink', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('renders an inline button (not an anchor) with the slot text, book icon, and dialog semantics', async () => {
    const wrapper = await mountDocLink();
    currentWrapper = wrapper;

    const trigger = wrapper.find('button.doc-link');
    expect(trigger.exists()).toBe(true);
    expect(trigger.attributes('type')).toBe('button');
    expect(trigger.attributes('aria-haspopup')).toBe('dialog');
    expect(trigger.text()).toContain('Read the guide');
    expect(wrapper.findComponent(BookOpenText).exists()).toBe(true);
    expect(trigger.element.tagName).toBe('BUTTON');
  });

  it('does not mount HelpPanel until the trigger is clicked', async () => {
    const wrapper = await mountDocLink();
    currentWrapper = wrapper;

    expect(wrapper.findComponent(HelpPanel).exists()).toBe(false);
  });

  it('opens HelpPanel scoped to the single guide on click', async () => {
    const wrapper = await mountDocLink();
    currentWrapper = wrapper;

    await wrapper.find('button.doc-link').trigger('click');
    await flushPromises();

    const panel = wrapper.findComponent(HelpPanel);
    expect(panel.exists()).toBe(true);
    expect(panel.props('guides')).toEqual([GUIDE]);
    expect(panel.props('audience')).toBe('calendar-owners');
  });

  it('defaults audience from the current route', async () => {
    const wrapper = await mountDocLink({ guide: GUIDE }, 'federation');
    currentWrapper = wrapper;

    await wrapper.find('button.doc-link').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(HelpPanel).props('audience')).toBe('instance-administrators');
  });

  it('uses an explicit audience prop over the route default', async () => {
    const wrapper = await mountDocLink({ guide: GUIDE, audience: 'instance-administrators' }, 'calendars');
    currentWrapper = wrapper;

    await wrapper.find('button.doc-link').trigger('click');
    await flushPromises();

    expect(wrapper.findComponent(HelpPanel).props('audience')).toBe('instance-administrators');
  });

  it('closes HelpPanel on its close event', async () => {
    const wrapper = await mountDocLink();
    currentWrapper = wrapper;

    await wrapper.find('button.doc-link').trigger('click');
    await flushPromises();
    expect(wrapper.findComponent(HelpPanel).exists()).toBe(true);

    wrapper.findComponent(HelpPanel).vm.$emit('close');
    await flushPromises();
    expect(wrapper.findComponent(HelpPanel).exists()).toBe(false);
  });
});
