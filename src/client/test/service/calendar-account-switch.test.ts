import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import sinon from 'sinon';
import axios from 'axios';
import { createPinia, setActivePinia } from 'pinia';
import AuthenticationService from '@/client/service/authn';
import CalendarService from '@/client/service/calendar';
import ModelService from '@/client/service/models';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar';

/** A token whose claims name `id`; the client never verifies the signature. */
function jwtFor(id: string): string {
  const claims = { id, email: `${id}@example.com`, isAdmin: false, exp: Math.floor(Date.now() / 1000) + 3600 };
  return 'header.' + btoa(JSON.stringify(claims)) + '.signature';
}

/**
 * A second account signing in without a logout (the session-expired modal's
 * in-place login) must not inherit the first account's calendars or
 * current calendar.
 */
describe('calendar store across an account switch', () => {
  let sandbox: sinon.SinonSandbox;
  let authn: AuthenticationService;
  let listStub: sinon.SinonStub;
  let postStub: sinon.SinonStub;

  async function loginAs(id: string) {
    postStub.resolves({ status: 200, data: jwtFor(id) });
    await authn.login(`${id}@example.com`, 'password');
  }

  beforeEach(() => {
    sandbox = sinon.createSandbox();
    localStorage.clear();
    setActivePinia(createPinia());
    // Keep the silent-refresh timer from being scheduled.
    sandbox.stub(AuthenticationService.prototype, '_refresh_login').resolves();
    postStub = sandbox.stub(axios, 'post');
    listStub = sandbox.stub(ModelService, 'listModels');
    listStub.withArgs('/api/v1/calendars').callsFake(async () => ({
      items: [{ id: `${currentId}-cal`, urlName: `${currentId}-cal`, userRelationship: 'owner' }],
    }));
    authn = new AuthenticationService(localStorage);
  });

  let currentId = '';

  afterEach(() => {
    axios.interceptors.request.eject(authn._requestInterceptorId);
    axios.interceptors.response.eject(authn._responseInterceptorId);
    sandbox.restore();
    localStorage.clear();
  });

  it('refetches and clears the current calendar when another account logs in', async () => {
    currentId = 'account-a';
    await loginAs('account-a');
    const service = new CalendarService();
    await service.ensureCalendarsLoaded();
    useCalendarStore().setSelectedCalendar('account-a-cal');

    currentId = 'account-b';
    await loginAs('account-b');
    const infos = await service.ensureCalendarsLoaded();

    sinon.assert.calledTwice(listStub);
    expect(infos.map((info) => info.calendar.id)).toEqual(['account-b-cal']);
    expect(useCalendarStore().accountId).toBe('account-b');
    expect(useCalendarStore().selectedCalendarId).toBeNull();
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
  });

  it('keeps the cached list and selection when the same account logs in again', async () => {
    currentId = 'account-a';
    await loginAs('account-a');
    const service = new CalendarService();
    await service.ensureCalendarsLoaded();
    useCalendarStore().setSelectedCalendar('account-a-cal');

    await loginAs('account-a');
    await service.ensureCalendarsLoaded();

    sinon.assert.calledOnce(listStub);
    expect(useCalendarStore().selectedCalendarId).toBe('account-a-cal');
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBe('account-a-cal');
  });
});
