import { describe, it, expect, afterEach, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { CalendarPlus, Cog, BookOpenText } from 'lucide-vue-next';

import ActionsMenu from '@/client/components/common/actions-menu.vue';
import ActionsMenuItem from '@/client/components/common/actions-menu-item.vue';
import { mountComponent } from '@/client/test/lib/vue';
import { screenReader, type ScreenReaderHandle } from '@/common/test-utils/screen-reader';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/destination', component: {}, name: 'destination' },
];

const Harness = defineComponent({
  components: { ActionsMenu, ActionsMenuItem },
  emits: ['doc', 'create'],
  setup(_, { emit }) {
    return () => h(ActionsMenu, { triggerLabel: 'Actions' }, () => [
      h(
        ActionsMenuItem,
        { icon: BookOpenText, onClick: () => emit('doc') },
        () => 'Documentation',
      ),
      h(
        ActionsMenuItem,
        { icon: CalendarPlus, onClick: () => emit('create') },
        () => 'New Calendar',
      ),
      h(
        ActionsMenuItem,
        { icon: Cog, to: { name: 'destination' } },
        () => 'Manage',
      ),
    ]);
  },
});

const mountHarness = async () => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  await router.push('/');
  await router.isReady();

  return mountComponent(Harness, router);
};

describe('ActionsMenu', () => {
  let currentWrapper: any = null;

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  it('renders the trigger with the provided aria-label and a closed panel', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    const trigger = wrapper.find('.actions-menu__trigger');
    expect(trigger.exists()).toBe(true);
    expect(trigger.attributes('aria-label')).toBe('Actions');
    expect(trigger.attributes('aria-haspopup')).toBe('menu');
    expect(trigger.attributes('aria-expanded')).toBe('false');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('opens the panel on trigger click and closes it on the second click', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    const trigger = wrapper.find('.actions-menu__trigger');

    await trigger.trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
    expect(trigger.attributes('aria-expanded')).toBe('true');

    await trigger.trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(trigger.attributes('aria-expanded')).toBe('false');
  });

  it('renders one menuitem per ActionsMenuItem child when open', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    await wrapper.find('.actions-menu__trigger').trigger('click');

    const items = wrapper.findAll('[role="menuitem"]');
    expect(items).toHaveLength(3);
    expect(items[0].text()).toContain('Documentation');
    expect(items[1].text()).toContain('New Calendar');
    expect(items[2].text()).toContain('Manage');
  });

  it('renders RouterLink items as anchor elements and button items as buttons', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    await wrapper.find('.actions-menu__trigger').trigger('click');

    const items = wrapper.findAll('[role="menuitem"]');
    expect(items[0].element.tagName).toBe('BUTTON');
    expect(items[1].element.tagName).toBe('BUTTON');
    expect(items[2].element.tagName).toBe('A');
  });

  it('closes the menu and emits click when a button item is activated', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    await wrapper.find('.actions-menu__trigger').trigger('click');

    const docItem = wrapper.findAll('[role="menuitem"]')[0];
    await docItem.trigger('click');

    expect(wrapper.emitted('doc')).toBeTruthy();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes the menu when a RouterLink item is activated', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    await wrapper.find('.actions-menu__trigger').trigger('click');

    const manageItem = wrapper.findAll('[role="menuitem"]')[2];
    await manageItem.trigger('click');
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes on Escape keydown', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    await wrapper.find('.actions-menu__trigger').trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it('closes on mousedown outside the menu', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    document.body.appendChild(wrapper.element);
    await wrapper.find('.actions-menu__trigger').trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    const outside = document.createElement('div');
    document.body.appendChild(outside);
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    outside.remove();
  });

  it('does NOT close on mousedown inside the panel', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;

    document.body.appendChild(wrapper.element);
    await wrapper.find('.actions-menu__trigger').trigger('click');

    const panel = wrapper.find('[role="menu"]').element as HTMLElement;
    panel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await flushPromises();

    expect(wrapper.find('[role="menu"]').exists()).toBe(true);
  });

  it('ArrowDown on the trigger opens the menu and focuses the first item', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;
    document.body.appendChild(wrapper.element);

    const trigger = wrapper.find('.actions-menu__trigger');
    await trigger.trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    const items = wrapper.findAll('[role="menuitem"]');
    expect(items.length).toBe(3);
    expect(document.activeElement).toBe(items[0].element);
  });

  it('ArrowDown inside the panel moves focus to the next item; ArrowUp to the previous', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;
    document.body.appendChild(wrapper.element);

    await wrapper.find('.actions-menu__trigger').trigger('keydown', { key: 'ArrowDown' });
    await flushPromises();

    const items = wrapper.findAll('[role="menuitem"]');

    await wrapper.find('[role="menu"]').trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1].element);

    await wrapper.find('[role="menu"]').trigger('keydown', { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[0].element);
  });

  it('returns focus to the trigger when the menu closes', async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;
    document.body.appendChild(wrapper.element);

    const trigger = wrapper.find('.actions-menu__trigger').element as HTMLButtonElement;
    await wrapper.find('.actions-menu__trigger').trigger('click');
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();

    expect(document.activeElement).toBe(trigger);
  });
});

describe('ActionsMenu screen reader announcement', () => {
  const COLLAPSED_TRIGGER = 'button, Actions, not expanded, has popup menu';
  const EXPANDED_TRIGGER = 'button, Actions, expanded, has popup menu';

  let currentWrapper: any = null;
  let sr: ScreenReaderHandle | null = null;

  afterEach(async () => {
    if (sr) {
      await sr.stop();
      sr = null;
    }
    if (currentWrapper) {
      currentWrapper.element.remove();
      currentWrapper.unmount();
      currentWrapper = null;
    }
  });

  // Mounted attached to the document so the virtual screen reader sees
  // the same tree a browser would.
  const mountAttached = async () => {
    const wrapper = await mountHarness();
    currentWrapper = wrapper;
    document.body.appendChild(wrapper.element);
    sr = await screenReader(wrapper.element);
    return { wrapper, sr };
  };

  it('announces the trigger as a collapsed menu button and exposes no menu', async () => {
    const { sr } = await mountAttached();

    const phrases = await sr.walk();

    // A sub-tree walk cycles back to its start, so the lone trigger is
    // spoken twice.
    expect(phrases).toEqual([COLLAPSED_TRIGGER, COLLAPSED_TRIGGER]);
  });

  it('announces the expanded trigger and each menu item after activation', async () => {
    const { wrapper, sr } = await mountAttached();

    await sr.next();
    expect(await sr.lastPhrase()).toBe(COLLAPSED_TRIGGER);

    await sr.act();
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(true);

    expect(await sr.walk()).toEqual([
      'menu, orientated vertically',
      'menuitem, Documentation, position 1, set size 3',
      'Documentation',
      'end of menuitem, Documentation, position 1, set size 3',
      'menuitem, New Calendar, position 2, set size 3',
      'New Calendar',
      'end of menuitem, New Calendar, position 2, set size 3',
      'menuitem, Manage, position 3, set size 3',
      'Manage',
      'end of menuitem, Manage, position 3, set size 3',
      'end of menu, orientated vertically',
      EXPANDED_TRIGGER,
    ]);
  });

  it('announces the trigger as collapsed again after a second activation', async () => {
    const { wrapper, sr } = await mountAttached();

    await sr.next();
    await sr.act();
    await flushPromises();
    // The walk ends back on the trigger, ready for the next activation.
    expect((await sr.walk()).at(-1)).toBe(EXPANDED_TRIGGER);

    await sr.act();
    await flushPromises();
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);

    expect(await sr.walk()).toEqual([COLLAPSED_TRIGGER, COLLAPSED_TRIGGER]);
  });
});
