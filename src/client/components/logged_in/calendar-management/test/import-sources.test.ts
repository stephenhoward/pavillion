import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { ImportSource } from '@/common/model/import_source';
import { mountComponent } from '@/client/test/lib/vue';
import ImportSourcesSection from '../import-sources/ImportSourcesSection.vue';
import ImportSourceService from '@/client/service/import_source';

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
      const addBtn = wrapper.find('.empty-state .pill-button--primary');
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

      await wrapper.find('.empty-state .pill-button--primary').trigger('click');
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

      await wrapper.find('.empty-state .pill-button--primary').trigger('click');
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
    });
  });

  describe('verify wiring', () => {
    it('opens DNS challenge modal when Verify is clicked on a pending source', async () => {
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
    });

    it('does not render Verify button when source is already verified', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'verified';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      expect(wrapper.find('.import-source-row__verify-btn').exists()).toBe(false);
    });

    it('fetches the challenge token via issueChallenge when Verify is clicked', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      s1.verificationState = 'pending';
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const verifyBtn = wrapper.find('.import-source-row__verify-btn');
      await verifyBtn.trigger('click');
      await flushPromises();

      expect(issueChallengeMock).toHaveBeenCalledWith(CALENDAR_ID, 'id-1');
      expect((wrapper.vm as any).state.challengeToken).toBe('test-challenge-token');
    });

    it('opens DNS challenge modal automatically after creating a new source', async () => {
      listSourcesMock.mockResolvedValue([]);
      const created = buildSource('new-id', 'https://new.example.com/cal.ics');
      created.verificationState = 'pending';
      createSourceMock.mockResolvedValue(created);

      const { wrapper } = mountSection();
      await flushPromises();

      await wrapper.find('.empty-state .pill-button--primary').trigger('click');
      await flushPromises();

      const form = wrapper.find('form.add-import-source-form');
      await form.find('input[type="url"]').setValue('https://new.example.com/cal.ics');
      await form.trigger('submit.prevent');
      await flushPromises();

      expect((wrapper.vm as any).state.challengeSource?.id).toBe('new-id');
    });
  });

  describe('AP-source warning', () => {
    it('renders warning when detectedApSource flag is set', async () => {
      const s1 = buildSource('id-1', 'https://mobilizon.example/cal.ics');
      (s1 as any).detectedApSource = true;
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      const warning = wrapper.find('.import-source-row__warning');
      expect(warning.exists()).toBe(true);
      expect(warning.text().length).toBeGreaterThan(0);
    });

    it('does not render warning when flag is absent', async () => {
      const s1 = buildSource('id-1', 'https://example.com/a.ics');
      listSourcesMock.mockResolvedValue([s1]);

      const { wrapper } = mountSection();
      await flushPromises();

      expect(wrapper.find('.import-source-row__warning').exists()).toBe(false);
    });
  });
});
