import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import ImportSourcesSection from '@/client/components/logged_in/calendar-management/import-sources/ImportSourcesSection.vue';
import ImportSourceList from '@/client/components/logged_in/calendar-management/import-sources/ImportSourceList.vue';
import VerifyOwnershipWizard from '@/client/components/logged_in/calendar-management/import-sources/VerifyOwnershipWizard.vue';
import ImportSourceService from '@/client/service/import_source';
import { useToast, resetToastState } from '@/client/composables/useToast';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const CALENDAR_ID = 'cal-1';

const buildSource = (id: string, url: string, overrides: Partial<ImportSource> = {}): ImportSource => {
  const source = new ImportSource(id, CALENDAR_ID, url);
  Object.assign(source, overrides);
  return source;
};

const mountSection = () => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const wrapper = mountComponent(ImportSourcesSection, router, {
    props: {
      calendarId: CALENDAR_ID,
    },
  });

  return { wrapper, router };
};

describe('ImportSourcesSection', () => {
  let listSourcesMock: ReturnType<typeof vi.fn>;
  let createSourceMock: ReturnType<typeof vi.fn>;
  let deleteSourceMock: ReturnType<typeof vi.fn>;
  let syncSourceMock: ReturnType<typeof vi.fn>;
  let getSourceMock: ReturnType<typeof vi.fn>;
  let issueChallengeMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    listSourcesMock = vi.fn();
    createSourceMock = vi.fn();
    deleteSourceMock = vi.fn();
    syncSourceMock = vi.fn();
    getSourceMock = vi.fn();
    issueChallengeMock = vi.fn().mockResolvedValue('test-challenge-token');

    vi.spyOn(ImportSourceService.prototype, 'listSources').mockImplementation(listSourcesMock);
    vi.spyOn(ImportSourceService.prototype, 'createSource').mockImplementation(createSourceMock);
    vi.spyOn(ImportSourceService.prototype, 'deleteSource').mockImplementation(deleteSourceMock);
    vi.spyOn(ImportSourceService.prototype, 'syncSource').mockImplementation(syncSourceMock);
    vi.spyOn(ImportSourceService.prototype, 'getSource').mockImplementation(getSourceMock);
    vi.spyOn(ImportSourceService.prototype, 'issueChallenge').mockImplementation(issueChallengeMock);

    // Toast state is module-scoped shared reactive state — reset per test so
    // assertions don't pick up toasts accumulated by earlier tests.
    resetToastState();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial load', () => {
    it('renders empty state when list is empty', async () => {
      listSourcesMock.mockResolvedValue([]);

      const { wrapper } = mountSection();
      await flushPromises();

      expect(listSourcesMock).toHaveBeenCalledWith(CALENDAR_ID);
      expect(wrapper.find('.empty-state').exists()).toBe(true);
      expect(wrapper.findAll('.import-source-row')).toHaveLength(0);
    });

    it('renders list of 2 sources', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      const s2 = buildSource('id-2', 'https://example.com/b.ics');
      listSourcesMock.mockResolvedValue([s1, s2]);

      const { wrapper } = mountSection();
      await flushPromises();

      const rows = wrapper.findAll('.import-source-row');
      expect(rows).toHaveLength(2);
      expect(rows[0].text()).toContain('https://example.com/a.ics');
      expect(rows[1].text()).toContain('https://example.com/b.ics');
      expect(wrapper.find('.empty-state').exists()).toBe(false);
    });

    it('shows error when loading fails', async () => {
      listSourcesMock.mockRejectedValue(new Error('boom'));

      const { wrapper } = mountSection();
      await flushPromises();

      expect(wrapper.find('.alert--error').exists()).toBe(true);
    });
  });

  describe('add form', () => {
    it('POSTs URL and prepends new source on success', async () => {
      listSourcesMock.mockResolvedValue([]);
      const created = buildSource('new-id', 'https://new.example.com/cal.ics');
      createSourceMock.mockResolvedValue(created);

      const { wrapper } = mountSection();
      await flushPromises();

      // Trigger empty-state add button
      const addBtn = wrapper.find('.empty-state .btn--cta');
      expect(addBtn.exists()).toBe(true);
      await addBtn.trigger('click');
      await flushPromises();

      // Form appears
      const form = wrapper.find('form.add-import-source-form');
      expect(form.exists()).toBe(true);

      // Fill URL and submit
      const input = form.find('input[type="url"]');
      await input.setValue('https://new.example.com/cal.ics');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createSourceMock).toHaveBeenCalledWith(CALENDAR_ID, 'https://new.example.com/cal.ics');
      expect((wrapper.vm as any).state.sources).toHaveLength(1);
      expect((wrapper.vm as any).state.sources[0].id).toBe('new-id');
      // Form is closed after success
      expect((wrapper.vm as any).state.showAddForm).toBe(false);
    });

    it('shows validation error when URL is whitespace-only', async () => {
      listSourcesMock.mockResolvedValue([]);

      const { wrapper } = mountSection();
      await flushPromises();

      await wrapper.find('.empty-state .btn--cta').trigger('click');
      await flushPromises();

      // Whitespace-only value — disabled submit button still won't fire, but
      // the form-level submit handler runs when we trigger submit on the form
      // element, which is how Enter-key submits work in the browser.
      const form = wrapper.find('form.add-import-source-form');
      await form.find('input[type="url"]').setValue('   ');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createSourceMock).not.toHaveBeenCalled();
      expect(form.find('.form-group__error').exists()).toBe(true);
    });

    it('shows error when create fails', async () => {
      listSourcesMock.mockResolvedValue([]);
      createSourceMock.mockRejectedValue(new Error('backend rejected'));

      const { wrapper } = mountSection();
      await flushPromises();

      await wrapper.find('.empty-state .btn--cta').trigger('click');
      await flushPromises();

      const form = wrapper.find('form.add-import-source-form');
      await form.find('input[type="url"]').setValue('https://fail.example.com/x.ics');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect(createSourceMock).toHaveBeenCalled();
      expect(form.find('.alert--error').exists()).toBe(true);
    });
  });

  describe('remove flow', () => {
    it('shows confirm modal and deletes on confirm', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      listSourcesMock.mockResolvedValue([s1]);
      deleteSourceMock.mockResolvedValue(undefined);

      const { wrapper } = mountSection();
      await flushPromises();

      // Click remove on the row
      const removeBtn = wrapper.find('.import-source-row .btn-ghost--danger');
      expect(removeBtn.exists()).toBe(true);
      await removeBtn.trigger('click');
      await flushPromises();

      // Confirmation modal appears
      expect(wrapper.find('.confirmation-modal').exists()).toBe(true);
      expect((wrapper.vm as any).state.sourceToRemove?.id).toBe('id-1');

      // Click the danger pill button inside the modal to confirm
      const confirmBtn = wrapper.find('.confirmation-modal .pill-button--danger');
      expect(confirmBtn.exists()).toBe(true);
      await confirmBtn.trigger('click');
      await flushPromises();

      expect(deleteSourceMock).toHaveBeenCalledWith(CALENDAR_ID, 'id-1');
      expect((wrapper.vm as any).state.sources).toHaveLength(0);
      expect((wrapper.vm as any).state.sourceToRemove).toBeNull();
    });

    it('cancels remove without deleting', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      await wrapper.find('.import-source-row .btn-ghost--danger').trigger('click');
      await flushPromises();

      // Cancel via the ghost button in the confirmation modal
      const cancelBtn = wrapper.find('.confirmation-modal .btn-ghost');
      await cancelBtn.trigger('click');
      await flushPromises();

      expect(deleteSourceMock).not.toHaveBeenCalled();
      expect((wrapper.vm as any).state.sourceToRemove).toBeNull();
      expect((wrapper.vm as any).state.sources).toHaveLength(1);
    });
  });

  describe('verification state gating', () => {
    it('disables Sync Now for unverified sources', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'unverified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      // Sync Now is the non-danger, non-verify btn-ghost in the row
      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      expect(syncBtn.exists()).toBe(true);
      expect(syncBtn.attributes('disabled')).toBeDefined();
    });

    it('enables Sync Now for verified sources', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      expect(syncBtn.exists()).toBe(true);
      expect(syncBtn.attributes('disabled')).toBeUndefined();
    });

    it('emits sync-requested when Sync Now clicked on verified source', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);
      syncSourceMock.mockResolvedValue({
        id: 'run-1',
        importSourceId: 'id-1',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'no_changes',
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        errorMessage: null,
      });
      getSourceMock.mockResolvedValue(s1);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      await syncBtn.trigger('click');
      await flushPromises();

      const emitted = wrapper.emitted('sync-requested');
      expect(emitted).toBeTruthy();
      expect(emitted?.[0]?.[0]).toEqual(expect.objectContaining({ id: 'id-1' }));
    });
  });

  describe('sync wiring', () => {
    it('calls syncSource and refreshes the row on success', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      syncSourceMock.mockResolvedValue({
        id: 'run-1',
        importSourceId: 'id-1',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'success',
        eventsCreated: 2,
        eventsUpdated: 1,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        errorMessage: null,
      });

      const refreshed = buildSource('id-1', 'https://example.com/a.ics');
      refreshed.verificationState = 'verified';
      refreshed.lastFetchedAt = new Date('2026-01-01T12:00:00Z');
      getSourceMock.mockResolvedValue(refreshed);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find('.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)');
      await syncBtn.trigger('click');
      await flushPromises();

      expect(syncSourceMock).toHaveBeenCalledWith(CALENDAR_ID, 'id-1');
      expect(getSourceMock).toHaveBeenCalledWith(CALENDAR_ID, 'id-1');
      // The row was replaced with the refreshed version
      expect((wrapper.vm as any).state.sources[0].lastFetchedAt).toEqual(refreshed.lastFetchedAt);
      // User-visible success toast — message should reflect created/updated
      // counts per the sync_success i18n template.
      const { toasts } = useToast();
      const successToasts = toasts.value.filter(t => t.type === 'success');
      expect(successToasts.length).toBeGreaterThan(0);
      // The rendered message mentions the numeric counts from the summary.
      expect(successToasts.some(t => t.message.includes('2') && t.message.includes('1'))).toBe(true);
    });

    it('shows a distinct success toast when sync run reports no_changes', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      syncSourceMock.mockResolvedValue({
        id: 'run-2',
        importSourceId: 'id-1',
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        outcome: 'no_changes',
        eventsCreated: 0,
        eventsUpdated: 0,
        eventsSkippedLocallyEdited: 0,
        eventsDisappeared: 0,
        errorMessage: null,
      });
      getSourceMock.mockResolvedValue(s1);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find('.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)');
      await syncBtn.trigger('click');
      await flushPromises();

      const { toasts } = useToast();
      const successToasts = toasts.value.filter(t => t.type === 'success');
      expect(successToasts.length).toBeGreaterThan(0);
      // sync_success_no_changes => 'Sync complete: no changes.' — distinct
      // from the counts-based message in the previous test.
      expect(successToasts.some(t => /no changes/i.test(t.message))).toBe(true);
      // And the message does NOT contain a numeric count marker.
      expect(successToasts.every(t => !/\b[1-9]\d*\b/.test(t.message))).toBe(true);
    });

    it('surfaces error without crashing when syncSource fails', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      syncSourceMock.mockRejectedValue(Object.assign(new Error('fail'), {
        name: 'ImportSourceFetchError',
      }));

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find('.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)');
      await syncBtn.trigger('click');
      await flushPromises();

      expect(syncSourceMock).toHaveBeenCalled();
      // syncingId is reset
      expect((wrapper.vm as any).state.syncingId).toBeNull();
      // User-visible error toast surfaces — errorMessageForSync resolves an
      // i18n string from the raw error's .name field (ImportSourceFetchError
      // => errors.fetch_error). Type-level assertion is locale-robust; the
      // message field itself must be non-empty.
      const { toasts } = useToast();
      const errorToasts = toasts.value.filter(t => t.type === 'error');
      expect(errorToasts.length).toBeGreaterThan(0);
      expect(errorToasts.every(t => t.message.length > 0)).toBe(true);
    });
  });

  describe('verify wiring', () => {
    it('opens the verify-ownership wizard when Verify is clicked on a pending source', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'pending';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const verifyBtn = wrapper.find('.import-source-row__verify-btn');
      expect(verifyBtn.exists()).toBe(true);
      await verifyBtn.trigger('click');
      await flushPromises();

      expect((wrapper.vm as any).state.challengeSource?.id).toBe('id-1');
      // The wizard is rendered via v-if once challengeSource is set.
      expect(wrapper.findComponent(VerifyOwnershipWizard).exists()).toBe(true);
    });

    it('does not render Verify button when source is already verified', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      expect(wrapper.find('.import-source-row__verify-btn').exists()).toBe(false);
    });

    it('does not pre-fetch the challenge token when Verify is clicked (wizard handles issuance)', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      // A 'pending' source has already committed to a verification method,
      // so the wizard skips the picker and lands directly on the matching
      // step — that's where the single issueChallenge call comes from.
      s1.verificationState = 'pending';
      s1.verificationType = 'dns-txt';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      // Reset the mock so we can isolate calls made AFTER the click. The
      // wizard's onMounted/watcher will issue once when the wizard mounts;
      // the section itself must not also pre-fetch as it did pre-pv-jutm.8.
      issueChallengeMock.mockClear();

      const verifyBtn = wrapper.find('.import-source-row__verify-btn');
      await verifyBtn.trigger('click');
      await flushPromises();

      // Exactly one issueChallenge call should be observed — the wizard's,
      // with the verification-type discriminator set. The section must not
      // make its own pre-fetch (which would have used the 2-arg signature).
      expect(issueChallengeMock).toHaveBeenCalledTimes(1);
      expect(issueChallengeMock).toHaveBeenCalledWith(CALENDAR_ID, 'id-1', 'dns-txt');
      // No more state.challengeToken — the wizard owns it now.
      expect((wrapper.vm as any).state.challengeToken).toBeUndefined();
    });

    it('onVerified updates the row and closes the wizard', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'pending';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      // Open the wizard via Verify click.
      await wrapper.find('.import-source-row__verify-btn').trigger('click');
      await flushPromises();

      expect((wrapper.vm as any).state.challengeSource?.id).toBe('id-1');

      // VerifyOwnershipWizard is rendered via v-if once challengeSource is set.
      const wizard = wrapper.findComponent(VerifyOwnershipWizard);
      expect(wizard.exists()).toBe(true);

      // Emit the 'verified' event with an updated source payload. The
      // handler replaces the stale row and calls closeChallengeModal.
      const updatedSource = buildSource('id-1', 'https://example.com/a.ics', {
        verificationState: 'verified',
      });
      wizard.vm.$emit('verified', updatedSource);
      await flushPromises();

      // Row replaced in state.
      expect((wrapper.vm as any).state.sources[0].verificationState).toBe('verified');
      // Wizard closed.
      expect((wrapper.vm as any).state.challengeSource).toBeNull();
    });

    it('opens the verify-ownership wizard automatically after creating a new source', async () => {
      listSourcesMock.mockResolvedValue([]);
      const created = buildSource('new-id', 'https://new.example.com/cal.ics');
      created.verificationState = 'pending';
      createSourceMock.mockResolvedValue(created);

      const { wrapper } = mountSection();
      await flushPromises();

      await wrapper.find('.empty-state .btn--cta').trigger('click');
      await flushPromises();

      const form = wrapper.find('form.add-import-source-form');
      await form.find('input[type="url"]').setValue('https://new.example.com/cal.ics');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect((wrapper.vm as any).state.challengeSource?.id).toBe('new-id');
      expect(wrapper.findComponent(VerifyOwnershipWizard).exists()).toBe(true);
    });

    it('returns focus to the trigger element when the wizard closes', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'pending';
      listSourcesMock.mockResolvedValue([s1]);

      // Focus a stand-in trigger button so that document.activeElement
      // points at it when the section opens the wizard. The section's
      // openChallengeModal captures the active element at open time, then
      // restores focus to it on close — the WCAG 2.4.3 contract this test
      // is verifying.
      const trigger = document.createElement('button');
      document.body.appendChild(trigger);
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      const { wrapper } = mountSection();
      await flushPromises();

      // Re-focus after the mount cycle in case happy-dom moved focus
      // during component mount.
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      // Open the wizard by emitting @verify on the import-source list
      // child — this is the same handler path the row's Verify button
      // hits. We grab the list via the row that the section already
      // rendered.
      const listWrapper = wrapper.findComponent(ImportSourceList);
      expect(listWrapper.exists()).toBe(true);
      listWrapper.vm.$emit('verify', s1);
      await flushPromises();

      expect((wrapper.vm as any).state.challengeSource?.id).toBe('id-1');

      // Close the wizard via verified emit — this should restore focus to
      // our trigger button on the next tick.
      const updated = buildSource('id-1', 'https://example.com/a.ics', {
        verificationState: 'verified',
      });
      wrapper.findComponent(VerifyOwnershipWizard).vm.$emit('verified', updated);
      await flushPromises();
      // Focus restoration is scheduled via nextTick.
      await flushPromises();

      expect(document.activeElement).toBe(trigger);
      trigger.remove();
      wrapper.unmount();
    });
  });

  describe('accessibility', () => {
    it('adds aria-disabled on the Sync Now button when unverified', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'unverified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      expect(syncBtn.attributes('aria-disabled')).toBe('true');
    });

    it('keeps aria-disabled=false on the Sync Now button when verified and idle', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      expect(syncBtn.attributes('aria-disabled')).toBe('false');
    });

    it('adds a URL-scoped aria-label to the Sync Now button', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      const label = syncBtn.attributes('aria-label');
      expect(label).toBeTruthy();
      // attribute is HTML-encoded in the serialized form (slashes become
      // &#x2F;); decode via a textarea to compare the decoded value.
      const decoder = document.createElement('textarea');
      decoder.innerHTML = label ?? '';
      const decoded = decoder.value;
      expect(decoded).toContain('Sync import source');
      expect(decoded).toContain('https://example.com/a.ics');
    });

    it('provides an sr-only disabled-reason referenced by aria-describedby', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'unverified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const syncBtn = wrapper.find(
        '.import-source-row .btn-ghost:not(.btn-ghost--danger):not(.import-source-row__verify-btn)',
      );
      const describedBy = syncBtn.attributes('aria-describedby');
      expect(describedBy).toBeTruthy();

      // At least one referenced element must exist in the row and be sr-only.
      const ids = (describedBy ?? '').split(/\s+/).filter(Boolean);
      const rowHtml = wrapper.find('.import-source-row').html();
      const foundSrOnly = ids.some((id) => {
        const escaped = id.replace(/"/g, '\\"');
        return rowHtml.includes(`id="${escaped}"`) && rowHtml.includes('sr-only');
      });
      expect(foundSrOnly).toBe(true);
    });

    it('does not mark the verification badge with role="status"', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const badge = wrapper.find('.import-source-row__badge');
      expect(badge.exists()).toBe(true);
      expect(badge.attributes('role')).toBeUndefined();
      // But still has an accessible name via aria-label
      expect(badge.attributes('aria-label')).toBeTruthy();
    });

    it('badge aria-label uses verification_badge_aria interpolation (state placeholder)', async () => {
      // Item 6 of pv-1qcp.15: switch from string concatenation to the
      // dedicated i18n key with a {state} placeholder. The label must
      // contain the verification state's localized label.
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const badge = wrapper.find('.import-source-row__badge');
      const ariaLabel = badge.attributes('aria-label') ?? '';
      // The key resolves to "Verification status: {{state}}"; we assert the
      // interpolated state appears (the verified label) without locking the
      // exact translation string.
      expect(ariaLabel.toLowerCase()).toContain('verified');
    });
  });
});
