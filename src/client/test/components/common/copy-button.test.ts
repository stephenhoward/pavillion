import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import CopyButton from '@/client/components/common/CopyButton.vue';
import { mountComponent } from '@/client/test/lib/vue';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
];

const mountCopyButton = (props: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  return mountComponent(CopyButton, router, {
    props: { text: 'snippet-to-copy', ...props },
  });
};

describe('CopyButton', () => {
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    try {
      delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
    }
    catch {
      // Some environments disallow delete on navigator; ignore.
    }
  });

  describe('rendering', () => {
    it('renders a button with the default Copy label', () => {
      const wrapper = mountCopyButton();
      const button = wrapper.find('button.copy-button');
      expect(button.exists()).toBe(true);
      expect(button.text()).toContain('Copy');
    });

    it('uses a caller-supplied label when provided', () => {
      const wrapper = mountCopyButton({ label: 'Copy HTML' });
      expect(wrapper.find('button').text()).toContain('Copy HTML');
    });

    it('uses the label as the default aria-label', () => {
      const wrapper = mountCopyButton({ label: 'Copy HTML' });
      expect(wrapper.find('button').attributes('aria-label')).toBe('Copy HTML');
    });

    it('honors an explicit aria-label over the visible label', () => {
      const wrapper = mountCopyButton({ label: 'Copy', ariaLabel: 'Copy HTML snippet' });
      expect(wrapper.find('button').attributes('aria-label')).toBe('Copy HTML snippet');
    });

    it('defaults to the ghost variant', () => {
      const wrapper = mountCopyButton();
      expect(wrapper.find('button').classes()).toContain('copy-button--ghost');
    });

    it('applies the primary variant when requested', () => {
      const wrapper = mountCopyButton({ variant: 'primary' });
      expect(wrapper.find('button').classes()).toContain('copy-button--primary');
    });

    it('renders an icon by default and hides it when withIcon is false', () => {
      const wrapper = mountCopyButton();
      expect(wrapper.find('button svg').exists()).toBe(true);

      const noIcon = mountCopyButton({ withIcon: false });
      expect(noIcon.find('button svg').exists()).toBe(false);
    });

    it('forwards the disabled prop and sets aria-disabled', () => {
      const wrapper = mountCopyButton({ disabled: true });
      const button = wrapper.find('button');
      expect(button.attributes('disabled')).toBeDefined();
      expect(button.attributes('aria-disabled')).toBe('true');
    });
  });

  describe('clipboard behavior', () => {
    it('writes the text prop to the clipboard on click', async () => {
      const wrapper = mountCopyButton({ text: 'snippet-value' });
      await wrapper.find('button').trigger('click');
      await flushPromises();
      expect(writeTextMock).toHaveBeenCalledWith('snippet-value');
    });

    it('emits "copied" after a successful write', async () => {
      const wrapper = mountCopyButton();
      await wrapper.find('button').trigger('click');
      await flushPromises();
      expect(wrapper.emitted('copied')).toBeTruthy();
    });

    it('flashes the copied label and reverts after feedbackMs', async () => {
      const wrapper = mountCopyButton({ label: 'Copy', copiedLabel: 'Copied!', feedbackMs: 1500 });
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('button').text()).toContain('Copied!');

      vi.advanceTimersByTime(1500);
      await flushPromises();

      expect(wrapper.find('button').text()).toContain('Copy');
      expect(wrapper.find('button').text()).not.toContain('Copied!');
    });

    it('still flashes the copied state when the clipboard call rejects (soft-fail)', async () => {
      writeTextMock.mockRejectedValue(new Error('denied'));

      const wrapper = mountCopyButton({ copiedLabel: 'Copied!' });
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('button').text()).toContain('Copied!');
      expect(wrapper.emitted('error')).toBeTruthy();
      expect(wrapper.emitted('copied')).toBeFalsy();
    });

    it('still flashes the copied state when navigator.clipboard is unavailable', async () => {
      delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;

      const wrapper = mountCopyButton({ copiedLabel: 'Copied!' });
      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('button').text()).toContain('Copied!');
      expect(wrapper.emitted('copied')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('renders a polite, atomic live region for screen readers', () => {
      const wrapper = mountCopyButton();
      const region = wrapper.find('[role="status"]');
      expect(region.exists()).toBe(true);
      expect(region.attributes('aria-live')).toBe('polite');
      expect(region.attributes('aria-atomic')).toBe('true');
    });

    it('announces the copied label in the live region after a click', async () => {
      const wrapper = mountCopyButton({ copiedLabel: 'Copied!' });
      const region = wrapper.find('[role="status"]');
      expect(region.text()).toBe('');

      await wrapper.find('button').trigger('click');
      await flushPromises();

      expect(wrapper.find('[role="status"]').text()).toBe('Copied!');
    });
  });
});
