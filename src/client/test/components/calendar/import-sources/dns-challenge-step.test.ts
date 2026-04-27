import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import DnsChallengeStep from '@/client/components/logged_in/calendar-management/import-sources/DnsChallengeStep.vue';
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

const mountStep = (propsOverride: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(DnsChallengeStep, router, {
    props: {
      source: buildSource(),
      instanceHost: INSTANCE_HOST,
      challengeToken: CHALLENGE_TOKEN,
      ...propsOverride,
    },
  });

  return { wrapper };
};

describe('DnsChallengeStep', () => {
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
      const { wrapper } = mountStep();
      await flushPromises();

      const nameInput = wrapper.find('input[readonly]');
      expect(nameInput.exists()).toBe(true);
      expect((nameInput.element as HTMLInputElement).value).toBe(
        '_pavillion-challenge.feeds.example.org',
      );
    });

    it('renders the record value in pavillion-verify=v1:host:token format', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const inputs = wrapper.findAll('input[readonly]');
      expect(inputs).toHaveLength(2);
      expect((inputs[1].element as HTMLInputElement).value).toBe(
        `pavillion-verify=v1:${INSTANCE_HOST}:${CHALLENGE_TOKEN}`,
      );
    });

    it('renders a step heading and a verify button', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      // Step renders its own heading inside the wizard chrome (not a modal title).
      const heading = wrapper.find('h3');
      expect(heading.exists()).toBe(true);
      expect(heading.text()).toContain('DNS record');

      // Verify action button (inside the PillButton element)
      const verifyBtn = wrapper.find('.pill-button--primary');
      expect(verifyBtn.exists()).toBe(true);
      expect(verifyBtn.text()).toContain('Verify');
    });

    it('exposes the wizard step data-test hook on the root section', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(true);
    });
  });

  describe('verify button', () => {
    it('calls verifySource with calendarId/id and emits verified on success', async () => {
      const verified = buildSource({ verificationState: 'verified' });
      verifyMock.mockResolvedValue(verified);

      const { wrapper } = mountStep();
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
      // The wizard owns dismissal; the step does not emit `close` itself.
      expect(wrapper.emitted('close')).toBeFalsy();
    });

    it('displays sanitized DNS error when verify fails with dns_not_found', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));

      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('DNS TXT record not found');
      // Step stays mounted on failure (wizard does not unmount on its own).
      expect(wrapper.emitted('verified')).toBeFalsy();
    });

    it('displays sanitized DNS error when verify fails with dns_mismatch', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_MISMATCH));

      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('does not match');
    });

    it('displays generic fallback for non-typed errors', async () => {
      verifyMock.mockRejectedValue(new Error('boom'));

      const { wrapper } = mountStep();
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
      const { wrapper } = mountStep();
      await flushPromises();

      const nameCopy = wrapper.find('[data-test="dns-copy-record-name"]');
      expect(nameCopy.exists()).toBe(true);

      await nameCopy.trigger('click');
      await flushPromises();

      expect(writeTextMock).toHaveBeenCalledWith(
        '_pavillion-challenge.feeds.example.org',
      );
    });

    it('copies the record value when the value copy button is clicked', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('[data-test="dns-copy-record-value"]').trigger('click');
      await flushPromises();

      expect(writeTextMock).toHaveBeenCalledWith(
        `pavillion-verify=v1:${INSTANCE_HOST}:${CHALLENGE_TOKEN}`,
      );
    });
  });

  describe('change-method affordance', () => {
    it('emits change-method when the change-method button is clicked', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const changeBtn = wrapper.find('[data-test="verify-wizard-change-method"]');
      expect(changeBtn.exists()).toBe(true);
      await changeBtn.trigger('click');
      await flushPromises();

      expect(wrapper.emitted('change-method')).toBeTruthy();
    });
  });

  describe('accessibility', () => {
    it('renders a polite live region for the copied state', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const liveRegion = wrapper.find('[role="status"][aria-live="polite"]');
      expect(liveRegion.exists()).toBe(true);
      expect(liveRegion.attributes('aria-atomic')).toBe('true');
    });

    it('announces Copied in the live region after clicking a copy button', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      // Before any click, live region is empty
      const regionBefore = wrapper.find('[role="status"][aria-live="polite"]');
      expect(regionBefore.text()).toBe('');

      await wrapper.find('[data-test="dns-copy-record-name"]').trigger('click');
      await flushPromises();

      const regionAfter = wrapper.find('[role="status"][aria-live="polite"]');
      expect(regionAfter.text()).toContain('Copied');
    });

    it('adds aria-live="polite" to the error alert', async () => {
      verifyMock.mockRejectedValue(new ImportSourceDnsVerificationError(IMPORT_DNS_NOT_FOUND));

      const { wrapper } = mountStep();
      await flushPromises();

      await wrapper.find('.pill-button--primary').trigger('click');
      await flushPromises();

      const alert = wrapper.find('.alert--error');
      expect(alert.exists()).toBe(true);
      expect(alert.attributes('aria-live')).toBe('polite');
      expect(alert.attributes('role')).toBe('alert');
    });

    it('labels the step section via aria-labelledby pointing at the heading', async () => {
      const { wrapper } = mountStep();
      await flushPromises();

      const section = wrapper.find('[data-test="verify-wizard-dns-step"]');
      const labelledBy = section.attributes('aria-labelledby');
      expect(labelledBy).toBeTruthy();

      const heading = wrapper.find('h3');
      expect(heading.attributes('id')).toBe(labelledBy);
    });
  });
});
