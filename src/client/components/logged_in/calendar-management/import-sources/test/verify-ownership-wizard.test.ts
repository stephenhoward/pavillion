import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource, ImportSourceVerificationType } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import VerifyOwnershipWizard from '../VerifyOwnershipWizard.vue';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const CALENDAR_ID = 'cal-1';
const SOURCE_ID = 'src-1';
const SOURCE_URL = 'https://feeds.example.org/calendar.ics';
const INSTANCE_HOST = 'pavillion.test';
const CHALLENGE_TOKEN = 'abc123tokenXYZ';

/**
 * Build an ImportSource for tests. Allows overriding `verificationType` with
 * `null` (cast through unknown) to express the "owner has not yet picked a
 * verification method" entry-state — the wizard shell treats any non-known
 * `verificationType` as an instruction to show the picker step.
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
      challengeToken: CHALLENGE_TOKEN,
      ...propsOverride,
    },
  });

  return { wrapper };
};

describe('VerifyOwnershipWizard', () => {
  describe('entry rule', () => {
    it('starts at the picker step when source.verificationType is null', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: null }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(false);
    });

    it('jumps directly to the dns-txt step when source.verificationType is dns-txt', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'dns-txt' }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(true);
      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(false);
    });

    it('jumps directly to the rel-me step when source.verificationType is rel-me', async () => {
      const { wrapper } = mountWizard({
        source: buildSource({ verificationType: 'rel-me' }),
      });
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-picker"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-dns-step"]').exists()).toBe(false);
      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(true);
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
      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(true);
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

      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(true);

      await wrapper.find('[data-test="verify-wizard-change-method"]').trigger('click');
      await flushPromises();

      expect(wrapper.find('[data-test="verify-wizard-relme-step"]').exists()).toBe(false);
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
});
