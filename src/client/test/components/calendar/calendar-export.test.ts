import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import i18next from 'i18next';
import { mountComponent } from '@/client/test/lib/vue';
import CalendarExport from '@/client/components/logged_in/calendar-management/export.vue';
import CalendarService from '@/client/service/calendar';
import { downloadIcs } from '@/common/utils/ics-generator';
import { ValidationError, UnknownError } from '@/common/exceptions/base';
import { CalendarExportError, CalendarNotFoundError } from '@/common/exceptions/calendar';
import { CalendarEditorPermissionError } from '@/common/exceptions/editor';

vi.mock('@/common/utils/ics-generator', () => ({
  downloadIcs: vi.fn(),
}));

const routes: RouteRecordRaw[] = [
  { path: '/settings/calendar/:calendar/export', component: {}, name: 'calendar_export' },
];

const CALENDAR_ID = 'cal-1';
const URL_NAME = 'test_calendar';

/** A list promise the test resolves or rejects when it chooses. */
function deferredList() {
  let resolve!: (languages: string[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function mountExport() {
  const router: Router = createRouter({ history: createMemoryHistory(), routes });
  return mountComponent(CalendarExport, router, {
    props: { calendarId: CALENDAR_ID, calendarUrlName: URL_NAME },
  });
}

/** Mount, set the interface language, then hand the page its list. */
async function mountWithList(languages: string[], uiLanguage = 'en') {
  const list = deferredList();
  vi.spyOn(CalendarService.prototype, 'getExportLanguages').mockReturnValue(list.promise);
  const wrapper = mountExport();
  await i18next.changeLanguage(uiLanguage);
  list.resolve(languages);
  await flushPromises();
  return wrapper;
}

const picker = (wrapper: ReturnType<typeof mountExport>) => wrapper.find<HTMLSelectElement>('select#calendar-export-language');
const downloadButton = (wrapper: ReturnType<typeof mountExport>) =>
  wrapper.findAll('button').filter((button) => button.text() === 'Download');
const statusRegion = (wrapper: ReturnType<typeof mountExport>) => wrapper.find('.calendar-export__status[role="status"]');
const alertRegion = (wrapper: ReturnType<typeof mountExport>) => wrapper.find('.calendar-export__error[role="alert"]');

describe('Calendar export page', () => {
  beforeEach(() => {
    vi.mocked(downloadIcs).mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await i18next.changeLanguage('en');
  });

  describe('loading the language list', () => {
    it('requests the list for its calendar and shows only the loading message until it arrives', async () => {
      const list = deferredList();
      const getLanguages = vi.spyOn(CalendarService.prototype, 'getExportLanguages').mockReturnValue(list.promise);

      const wrapper = mountExport();
      await flushPromises();

      expect(getLanguages).toHaveBeenCalledWith(CALENDAR_ID);
      expect(wrapper.find('.loading-message').text()).toContain('Loading the export options');
      expect(picker(wrapper).exists()).toBe(false);
      expect(downloadButton(wrapper)).toHaveLength(0);
      expect(wrapper.text()).toContain('every event this calendar publishes');

      list.resolve(['en', 'es']);
      await flushPromises();

      expect(wrapper.find('.loading-message').exists()).toBe(false);
      expect(downloadButton(wrapper)).toHaveLength(1);
    });

    it('fills the alert region and renders neither picker nor button when the list fails', async () => {
      const list = deferredList();
      vi.spyOn(CalendarService.prototype, 'getExportLanguages').mockReturnValue(list.promise);
      const wrapper = mountExport();
      await flushPromises();
      expect(alertRegion(wrapper).exists()).toBe(true);
      expect(alertRegion(wrapper).text()).toBe('');

      list.reject(new UnknownError());
      await flushPromises();

      expect(alertRegion(wrapper).text()).toContain('could not be loaded');
      expect(alertRegion(wrapper).classes()).toContain('alert--error');
      expect(picker(wrapper).exists()).toBe(false);
      expect(downloadButton(wrapper)).toHaveLength(0);
    });

    it('shows the permission message when the list is refused to a non-owner', async () => {
      const list = deferredList();
      vi.spyOn(CalendarService.prototype, 'getExportLanguages').mockReturnValue(list.promise);
      const wrapper = mountExport();
      list.reject(new CalendarEditorPermissionError());
      await flushPromises();

      expect(alertRegion(wrapper).text()).toContain('Only the calendar\'s owner');
    });
  });

  describe('the language picker', () => {
    it('defaults to the interface language when the list has it', async () => {
      const wrapper = await mountWithList(['en', 'es', 'fr'], 'es');

      expect(picker(wrapper).element.value).toBe('es');
    });

    it('defaults to the first entry when the list lacks the interface language', async () => {
      const wrapper = await mountWithList(['fr', 'es'], 'en');

      expect(picker(wrapper).element.value).toBe('fr');
    });

    it('lists the options in the server\'s order', async () => {
      const wrapper = await mountWithList(['fr', 'en', 'es']);

      const values = picker(wrapper).findAll('option').map((option) => option.element.value);
      expect(values).toEqual(['fr', 'en', 'es']);
    });

    it('has a visible label', async () => {
      const wrapper = await mountWithList(['en', 'es']);

      expect(wrapper.find('label[for="calendar-export-language"]').text()).toBe('Language');
    });

    it('is not rendered for a one-language list, and Download still sends that language', async () => {
      const exportCalendar = vi.spyOn(CalendarService.prototype, 'exportCalendar')
        .mockResolvedValue({ ics: 'BEGIN:VCALENDAR', eventCount: 2 });
      const wrapper = await mountWithList(['es'], 'en');

      expect(picker(wrapper).exists()).toBe(false);

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(exportCalendar).toHaveBeenCalledWith(CALENDAR_ID, 'es');
      expect(downloadIcs).toHaveBeenCalledWith('BEGIN:VCALENDAR', 'test_calendar-es.ics');
    });
  });

  describe('downloading', () => {
    it('saves <url-name>-<lang>.ics in the chosen language and announces it', async () => {
      const exportCalendar = vi.spyOn(CalendarService.prototype, 'exportCalendar')
        .mockResolvedValue({ ics: 'BEGIN:VCALENDAR', eventCount: 4 });
      const wrapper = await mountWithList(['en', 'es', 'fr']);

      await picker(wrapper).setValue('fr');
      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(exportCalendar).toHaveBeenCalledWith(CALENDAR_ID, 'fr');
      expect(downloadIcs).toHaveBeenCalledWith('BEGIN:VCALENDAR', 'test_calendar-fr.ics');
      expect(statusRegion(wrapper).text()).toContain('test_calendar-fr.ics');
      expect(alertRegion(wrapper).text()).toBe('');
    });

    it('saves when the server does not report a count', async () => {
      vi.spyOn(CalendarService.prototype, 'exportCalendar').mockResolvedValue({ ics: 'BEGIN:VCALENDAR', eventCount: null });
      const wrapper = await mountWithList(['en']);

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(downloadIcs).toHaveBeenCalledWith('BEGIN:VCALENDAR', 'test_calendar-en.ics');
    });

    it('says the calendar has no events and saves nothing when the count is 0', async () => {
      vi.spyOn(CalendarService.prototype, 'exportCalendar').mockResolvedValue({ ics: 'BEGIN:VCALENDAR', eventCount: 0 });
      const wrapper = await mountWithList(['en']);

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(downloadIcs).not.toHaveBeenCalled();
      expect(statusRegion(wrapper).text()).toContain('no events of its own');
    });

    it('ignores a second press while a download is running, without disabling the button', async () => {
      let finish!: (value: { ics: string; eventCount: number }) => void;
      const exportCalendar = vi.spyOn(CalendarService.prototype, 'exportCalendar')
        .mockReturnValue(new Promise((resolve) => { finish = resolve; }));
      const wrapper = await mountWithList(['en']);
      const button = downloadButton(wrapper)[0];

      await button.trigger('click');
      expect(wrapper.find('button').text()).toBe('Preparing the file…');
      expect(wrapper.find('button').attributes('disabled')).toBeUndefined();
      await wrapper.find('button').trigger('click');

      finish({ ics: 'BEGIN:VCALENDAR', eventCount: 1 });
      await flushPromises();

      expect(exportCalendar).toHaveBeenCalledTimes(1);
      expect(downloadButton(wrapper)).toHaveLength(1);
    });

    it.each([
      ['CalendarExportError', new CalendarExportError(), 'could not be created'],
      ['ValidationError', new ValidationError('bad lang'), 'no longer available'],
      ['CalendarEditorPermissionError', new CalendarEditorPermissionError(), 'Only the calendar\'s owner'],
      ['CalendarNotFoundError', new CalendarNotFoundError(), 'could not be found'],
      ['an unknown failure', new UnknownError(), 'download failed'],
    ])('shows the translated message for %s and saves nothing', async (_label, error, expected) => {
      vi.spyOn(CalendarService.prototype, 'exportCalendar').mockRejectedValue(error);
      const wrapper = await mountWithList(['en']);

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(downloadIcs).not.toHaveBeenCalled();
      expect(alertRegion(wrapper).text()).toContain(expected);
      expect(alertRegion(wrapper).text()).not.toContain('bad lang');
      expect(statusRegion(wrapper).text()).toBe('');
    });

    it('clears an earlier error when a new download starts', async () => {
      const exportCalendar = vi.spyOn(CalendarService.prototype, 'exportCalendar')
        .mockRejectedValueOnce(new UnknownError())
        .mockResolvedValueOnce({ ics: 'BEGIN:VCALENDAR', eventCount: 1 });
      const wrapper = await mountWithList(['en']);

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();
      expect(alertRegion(wrapper).text()).not.toBe('');

      await downloadButton(wrapper)[0].trigger('click');
      await flushPromises();

      expect(exportCalendar).toHaveBeenCalledTimes(2);
      expect(alertRegion(wrapper).text()).toBe('');
      expect(alertRegion(wrapper).classes()).not.toContain('alert--error');
      expect(statusRegion(wrapper).text()).toContain('test_calendar-en.ics');
    });
  });
});
