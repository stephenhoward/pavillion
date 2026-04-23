import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import DnsChallengeModal from '../import-sources/DnsChallengeModal.vue';
import ImportSourceService from '@/client/service/import_source';
import {
  ImportSourceDnsVerificationError,
  IMPORT_DNS_NOT_FOUND,
  IMPORT_DNS_MISMATCH,
} from '@/common/exceptions/import';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const CALENDAR_ID = 'cal-1';
const SOURCE_ID = 'src-1';
const SOURCE_URL = 'https://feeds.example.org/calendar.ics';
const INSTANCE_HOST = 'pavillion.test';
const CHALLENGE_TOKEN = 'abc123tokenXYZ';

const buildSource = (overrides: Partial<ImportSource> = {}): ImportSource => {
  const source = new ImportSource(SOURCE_ID, CALENDAR_ID, SOURCE_URL);
  source.verificationState = 'pending';
  Object.assign(source, overrides);
  return source;
};

const mountModal = (propsOverride: Record<string, any> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(DnsChallengeModal, router, {
    props: {
      source: buildSource(),
      instanceHost: INSTANCE_HOST,
      challengeToken: CHALLENGE_TOKEN,
      ...propsOverride,
    },
  });

  return { wrapper };
};

describe('DnsChallengeModal', () => {
  let verifyMock: ReturnType<typeof vi.fn>;
  let writeTextMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    verifyMock = vi.fn();
    vi.spyOn(ImportSourceService.prototype, 'verifySource').mockImplementation(verifyMock);

    writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
    }
    catch {
      // Some environments disallow delete on navigator; ignore.
    }
  });

  describe('rendering', () => {
    it('renders the record name derived from source URL hostname', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      const nameInput = wrapper.find('input[readonly]');
      expect(nameInput.exists()).toBe(true);
      expect((nameInput.element as HTMLInputElement).value).toBe(
        '_pavillion-challenge.feeds.example.org',
      );
    });

    it('renders the record value in pavillion-verify=v1:host:token format', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      const inputs = wrapper.findAll('input[readonly]');
      expect(inputs).toHaveLength(2);
      expect((inputs[1].element as HTMLInputElement).value).toBe(
        `pavillion-verify=v1:${INSTANCE_HOST}:${CHALLENGE_TOKEN}`,
      );
    });

    it('includes the title and verify button', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      // Modal is a <dialog> — check title rendered inside header h2
      expect(wrapper.find('h2').text()).toContain('Verify');
      // Verify action button (inside the PillButton element)
      const verifyBtn = wrapper.find('.pill-button--primary');
      expect(verifyBtn.exists()).toBe(true);
      expect(verifyBtn.text()).toContain('Verify');
    });
  });

  describe('verify button', () => {
    it('calls verifySource with calendarId/id and emits verified on success', async () => {
      const verified = buildSource({ verificationState: 'verified' });
      verifyMock.mockResolvedValue(verified);

      const { wrapper } = mountModal();
      await flushPromises();

      const verifyBtn = wrapper.find('.pill-button--primary');
      await verifyBtn.trigger('click');
      await flushPromises();

      expect(verifyMock).toHaveBeenCalledWith(CALENDAR_ID, SOURCE_ID);

      const emitted = wrapper.emitted('verified');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]?.[0]).toEqual(
        expect.objectContaining({ id: SOURCE_ID, verificationState: 'verified' }),
      );
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('displays sanitized DNS error when verify fails with dns_not_found', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));

      const { wrapper } = mountModal();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('DNS TXT record not found');
      // Modal stays open on failure
      expect(wrapper.emitted('close')).toBeFalsy();
    });

    it('displays sanitized DNS error when verify fails with dns_mismatch', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_MISMATCH));

      const { wrapper } = mountModal();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('does not match');
    });

    it('displays generic fallback for non-typed errors', async () => {
      verifyMock.mockRejectedValue(new Error('boom'));

      const { wrapper } = mountModal();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      // Should show something non-empty and not leak raw error
      expect(alert.text().length).toBeGreaterThan(0);
      expect(alert.text()).not.toContain('boom');
    });
  });

  describe('copy-to-clipboard', () => {
    it('copies the record name when the name copy button is clicked', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      const copyBtns = wrapper.findAll('.dns-challenge__copy-btn');
      expect(copyBtns.length).toBeGreaterThanOrEqual(2);

      await copyBtns[0].trigger('click');
      await flushPromises();

      expect(writeTextMock).toHaveBeenCalledWith(
        '_pavillion-challenge.feeds.example.org',
      );
    });

    it('copies the record value when the value copy button is clicked', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      const copyBtns = wrapper.findAll('.dns-challenge__copy-btn');
      await copyBtns[1].trigger('click');
      await flushPromises();

      expect(writeTextMock).toHaveBeenCalledWith(
        `pavillion-verify=v1:${INSTANCE_HOST}:${CHALLENGE_TOKEN}`,
      );
    });
  });

  describe('close interactions', () => {
    it('emits close when the Close button is clicked', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      // Find the Close button (ghost button in the actions area).
      const closeBtn = wrapper.find('.dns-challenge__actions .btn-ghost');
      expect(closeBtn.exists()).toBe(true);
      await closeBtn.trigger('click');
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('renders a polite live region for the copied state', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      const liveRegion = wrapper.find('[role="status"][aria-live="polite"]');
      expect(liveRegion.exists()).toBe(true);
      expect(liveRegion.attributes('aria-atomic')).toBe('true');
      // Visually hidden via sr-only utility class
      expect(liveRegion.classes()).toContain('sr-only');
    });

    it('announces Copied in the live region after clicking a copy button', async () => {
      const { wrapper } = mountModal();
      await flushPromises();

      // Before any click, live region is empty
      const regionBefore = wrapper.find('[role="status"][aria-live="polite"]');
      expect(regionBefore.text()).toBe('');

      const copyBtns = wrapper.findAll('.dns-challenge__copy-btn');
      await copyBtns[0].trigger('click');
      await flushPromises();

      const regionAfter = wrapper.find('[role="status"][aria-live="polite"]');
      expect(regionAfter.text()).toContain('Copied');
    });

    it('adds aria-live="polite" to the error alert', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));

      const { wrapper } = mountModal();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.attributes('aria-live')).toBe('polite');
      expect(alert.attributes('role')).toBe('alert');
    });

    it('returns focus to the triggering element when the modal unmounts', async () => {
      // Create a trigger button in the DOM that is the activeElement when
      // the modal mounts — simulates the Verify button in ImportSourceRow.
      const trigger = document.createElement('button');
      trigger.textContent = 'Verify';
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { wrapper } = mountModal();
      await flushPromises();

      // Unmounting the modal (v-if=false from parent) should restore focus
      // to the original trigger via the onBeforeUnmount hook.
      wrapper.unmount();
      // Allow the nextTick scheduled inside onBeforeUnmount to resolve
      await flushPromises();

      expect(document.activeElement).toBe(trigger);

      trigger.remove();
    });
  });
});
