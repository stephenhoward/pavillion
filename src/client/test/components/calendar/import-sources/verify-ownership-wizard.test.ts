import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource, ImportSourceVerificationType } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import ImportSourceService from '@/client/service/import_source';
import VerifyOwnershipWizard from '@/client/components/logged_in/calendar-management/import-sources/VerifyOwnershipWizard.vue';
import DnsChallengeStep from '@/client/components/logged_in/calendar-management/import-sources/DnsChallengeStep.vue';
import RelMeChallengeStep from '@/client/components/logged_in/calendar-management/import-sources/RelMeChallengeStep.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const CALENDAR_ID = 'cal-1';
const SOURCE_ID = 'src-1';
const SOURCE_URL = 'https://feeds.example.org/calendar.ics';
const INSTANCE_HOST = 'pavillion.test';
const CHALLENGE_TOKEN = 'abc123tokenXYZ';

/**
 * Build an ImportSource for tests. `verificationType` is now nullable on the
 * model itself — `null` expresses the "owner has not yet picked a
 * verification method" entry-state and tells the wizard to show the picker.
 */
const buildSource = (overrides: Partial<ImportSource> & { verificationType?: ImportSourceVerificationType | null } = {}): ImportSource => {
  const source = new ImportSource(SOURCE_ID, CALENDAR_ID, SOURCE_URL);
  source.verificationState = 'unverified';
  Object.assign(source, overrides);
  return source;
};

const mountWizard = (propsOverride: Record<string, unknown> = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(VerifyOwnershipWizard, router, {
    props: {
      source: buildSource({ verificationType: null }),
      instanceHost: INSTANCE_HOST,
      ...propsOverride,
    },
  });

  return { wrapper };
};

describe('VerifyOwnershipWizard', () => {
  let issueChallengeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    issueChallengeMock = vi.fn().mockResolvedValue(CHALLENGE_TOKEN);
    vi.spyOn(ImportSourceService.prototype, 'issueChallenge').mockImplementation(issueChallengeMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('entry rule', () => {
    it('starts at the picker step when source.verificationType is null', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(false);
    });

    it('jumps directly to the dns-txt step when source.verificationType is dns-txt', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'dns-txt' }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(false);
    });

    it('jumps directly to the rel-me step when source.verificationType is rel-me', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'rel-me' }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(true);
    });
  });

  describe('picker navigation', () => {
    it('advances to the dns-txt step when the DNS method card is clicked', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      await wrapper.find('[data-test="verify-wizard-pick-dns"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(true);
    });

    it('advances to the rel-me step when the rel="me" method card is clicked', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      await wrapper.find('[data-test="verify-wizard-pick-relme"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(true);
    });
  });

  describe('change-method affordance', () => {
    it('returns to the picker when the change-method button is clicked from the dns-txt step', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'dns-txt' }),
      });
      await flushPromises();

      // Confirm we started on the dns step (entry rule covered separately)
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(true);

      await wrapper.find('[data-test="verify-wizard-change-method"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(true);
    });

    it('returns to the picker when the change-method button is clicked from the rel-me step', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'rel-me' }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(true);

      await wrapper.find('[data-test="rel-me-change-method"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-test="rel-me-challenge-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(true);
    });
  });

  describe('close', () => {
    it('emits close when the wizard is dismissed via the modal', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      // The Cancel button in the picker step closes the wizard.
      const cancelBtn = wrapper.find('[data-test="verify-wizard-cancel"]');
      expect(cancelBtn.exists()).toBe(true);
      await cancelBtn.trigger('click');
      await flushPromises();

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('challenge issuance', () => {
    it('issues a dns-txt challenge on mount when the entry rule lands on dns-txt', async () => {
      mountWizard({
        source: buildSource({ verificationType: 'dns-txt' }),
      });
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledWith(CALENDAR_ID, SOURCE_ID, 'dns-txt');
    });

    it('issues a rel-me challenge on mount when the entry rule lands on rel-me', async () => {
      mountWizard({
        source: buildSource({ verificationType: 'rel-me' }),
      });
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledWith(CALENDAR_ID, SOURCE_ID, 'rel-me');
    });

    it('does not issue a challenge while the picker is showing', async () => {
      mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      expect(issueChallengeMock).not.toHaveBeenCalled();
    });

    it('issues a challenge after the user picks a method', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();
      expect(issueChallengeMock).not.toHaveBeenCalled();

      await wrapper.find('[data-test="verify-wizard-pick-dns"]').trigger('click');
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledWith(CALENDAR_ID, SOURCE_ID, 'dns-txt');
    });
  });

  describe('verified relay', () => {
    it('relays verified emit from the dns-txt step to its own consumer', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'dns-txt' }),
      });
      await flushPromises();

      const updated = buildSource({ verificationState: 'verified' });
      const dnsStep = wrapper.findComponent(DnsChallengeStep);
      expect(dnsStep.exists()).toBe(true);
      dnsStep.vm.$emit('verified', updated);
      await flushPromises();

      const emitted = wrapper.emitted('verified');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]?.[0]).toEqual(
        expect.objectContaining({ id: SOURCE_ID, verificationState: 'verified' }),
      );
    });

    it('relays verified emit from the rel-me step to its own consumer', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'rel-me' }),
      });
      await flushPromises();

      const updated = buildSource({ verificationState: 'verified' });
      const relMeStep = wrapper.findComponent(RelMeChallengeStep);
      expect(relMeStep.exists()).toBe(true);
      relMeStep.vm.$emit('verified', updated);
      await flushPromises();

      const emitted = wrapper.emitted('verified');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]?.[0]).toEqual(
        expect.objectContaining({ id: SOURCE_ID, verificationState: 'verified' }),
      );
    });
  });
});
