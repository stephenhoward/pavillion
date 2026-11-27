import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import axios from 'axios';
import HousekeepingStatus from '@/client/components/admin/housekeeping-status.vue';
import enAdmin from '@/client/locales/en/admin.json';
import esAdmin from '@/client/locales/es/admin.json';
import frAdmin from '@/client/locales/fr/admin.json';

vi.mock('axios');

const NOW = new Date('2026-01-13T03:40:00.000Z');

// Synthetic figures. totalBytes - freeBytes (70 GiB) differs from usedBytes
// (50 GiB) because 20 GiB are reserved for root, as on ext4.
const GIB = 1024 ** 3;
const status = {
  lastBackup: null,
  nextBackup: null,
  diskUsage: {
    percentageUsed: 62.5,
    totalBytes: String(100 * GIB),
    usedBytes: String(50 * GIB),
    freeBytes: String(30 * GIB),
    measuredAt: '2026-01-13T03:00:00.000Z',
  },
  alerts: ['ok'],
  retentionStats: {
    daily: { current: 0, target: 7 },
    weekly: { current: 0, target: 4 },
    monthly: { current: 0, target: 12 },
  },
};

describe('HousekeepingStatus', () => {
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.mocked(axios.get).mockResolvedValue({ data: status });

    await i18next.init({
      lng: 'en',
      resources: {
        en: { admin: enAdmin },
        es: { admin: esAdmin },
        fr: { admin: frAdmin },
      },
      interpolation: { escapeValue: false },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function mountExpanded() {
    const wrapper = mount(HousekeepingStatus, {
      global: { plugins: [[I18NextVue, { i18next }]] },
    });
    await flushPromises();
    await wrapper.find('.status-header').trigger('click');
    return wrapper;
  }

  it('shows the snapshot used bytes and a percentage of used + free, as df reports', async () => {
    const wrapper = await mountExpanded();

    const used = Number(status.diskUsage.usedBytes);
    const free = Number(status.diskUsage.freeBytes);
    expect(status.diskUsage.percentageUsed).toBe(used / (used + free) * 100);

    expect(wrapper.find('.disk-stats-text').text()).toBe('50.0 GB / 100.0 GB');
    expect(wrapper.find('.disk-percentage').text()).toContain('62.5%');
  });

  it.each([
    ['en', 'Measured 40 minutes ago'],
    ['es', 'Medido hace 40 minutos'],
    ['fr', 'Mesuré il y a 40 minutes'],
  ])('says when the reading was taken in %s', async (lng, expected) => {
    await i18next.changeLanguage(lng);

    const wrapper = await mountExpanded();

    expect(wrapper.find('.disk-measured').text()).toBe(expected);
  });
});
