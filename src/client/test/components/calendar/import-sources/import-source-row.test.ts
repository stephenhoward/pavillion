import { describe, it, expect } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';

import { mountComponent } from '@/client/test/lib/vue';
import ImportSourceRow from '@/client/components/logged_in/calendar-management/import-sources/ImportSourceRow.vue';
import { ImportSource } from '@/common/model/import_source';

const mountRow = (source: ImportSource) => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/test', component: {}, name: 'test' }],
  });
  return mountComponent(ImportSourceRow, router, { props: { source } });
};

/**
 * The server derives `verificationState` and `canSync` (see
 * ImportSourceEntity.toModel); the row renders them without a clock.
 */
const makeSource = (state: ImportSource['verificationState'], canSync: boolean) => {
  const source = new ImportSource('src-1', 'cal-1', 'https://example.com/cal.ics');
  source.verificationState = state;
  source.canSync = canSync;
  return source;
};

const syncButton = (wrapper: ReturnType<typeof mountRow>) =>
  wrapper.findAll('button').find((b) => b.attributes('aria-label')?.includes('sync_aria') || b.attributes('aria-label')?.startsWith('Sync'));

describe('ImportSourceRow lapsed verification', () => {
  it('before expiry: verified badge, Sync enabled, no Verify button', () => {
    const wrapper = mountRow(makeSource('verified', true));

    expect(wrapper.find('.import-source-row__badge--verified').exists()).toBe(true);
    expect(wrapper.find('.import-source-row__verify-btn').exists()).toBe(false);
    expect(syncButton(wrapper)!.attributes('disabled')).toBeUndefined();
  });

  it('in grace: expired badge, Verify offered, Sync still enabled', () => {
    const wrapper = mountRow(makeSource('expired', true));

    expect(wrapper.find('.import-source-row__badge--expired').exists()).toBe(true);
    expect(wrapper.find('.import-source-row__verify-btn').exists()).toBe(true);
    expect(syncButton(wrapper)!.attributes('disabled')).toBeUndefined();
  });

  it('past grace: expired badge, Verify offered, Sync disabled', () => {
    const wrapper = mountRow(makeSource('expired', false));

    expect(wrapper.find('.import-source-row__badge--expired').exists()).toBe(true);
    expect(wrapper.find('.import-source-row__verify-btn').exists()).toBe(true);
    expect(syncButton(wrapper)!.attributes('disabled')).toBeDefined();
  });
});
