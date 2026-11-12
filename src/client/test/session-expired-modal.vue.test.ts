import { expect, describe, it, beforeEach, afterEach } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import sinon from 'sinon';
import { ref } from 'vue';
import { createPinia, setActivePinia, Pinia } from 'pinia';

import { mountComponent } from '@/client/test/lib/vue';
import SessionExpiredModal from '@/client/components/common/session-expired-modal.vue';
import Modal from '@/client/components/common/modal.vue';
import LoginForm from '@/client/components/logged_out/LoginForm.vue';
import { useCalendarStore } from '@/client/stores/calendarStore';
import { useEventStore } from '@/client/stores/eventStore';
import { Calendar } from '@/common/model/calendar';
import { CalendarInfo } from '@/common/model/calendar_info';
import { CURRENT_CALENDAR_STORAGE_KEY } from '@/client/service/current-calendar-storage';
import CalendarService from '@/client/service/calendar';
import ModelService from '@/client/service/models';

const routes: RouteRecordRaw[] = [
  { path: '/', component: {}, name: 'home' },
  { path: '/auth/login', component: {}, name: 'login', props: true },
  { path: '/auth/register', component: {}, name: 'register', props: true },
  { path: '/auth/forgot', component: {}, name: 'forgot_password', props: true },
  { path: '/auth/apply', component: {}, name: 'register-apply', props: true },
  { path: '/auth/reset', component: {}, name: 'reset_password', props: true },
];

interface MountedOptions {
  lastKnownEmail?: string | null;
  lastKnownAccountId?: string | null;
  sandbox?: sinon.SinonSandbox;
  pinia?: Pinia;
}

/** Store an unexpired token for `accountId`, as a successful login would. */
function signInAs(accountId: string) {
  const exp = Math.floor(Date.now() / 1000) + 3600;
  localStorage.setItem('jw_token', JSON.stringify({ exp, id: accountId, isAdmin: false, email: `${accountId}@example.com` }));
}

/** Load the calendar store for `accountId`, as the app does after sign-in. */
function loadCalendarsFor(accountId: string) {
  const calendarStore = useCalendarStore();
  const calendar = new Calendar(`${accountId}-cal`, `${accountId}-calendar`);
  calendarStore.setCalendarInfos([new CalendarInfo(calendar, 'owner')], accountId);
  calendarStore.setSelectedCalendar(calendar.id);
  return calendarStore;
}

const mountedSessionExpiredModal = (options: MountedOptions = {}) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  const sandbox = options.sandbox ?? sinon.createSandbox();
  const sessionExpired = ref(true);

  // Fakes implement the real side effect: drain/abort both clear the sessionExpired flag,
  // which is what causes the modal to unmount when the parent (app.vue) re-renders.
  const authn = {
    sessionExpired,
    lastKnownEmail: options.lastKnownEmail ?? null,
    lastKnownAccountId: sandbox.stub().returns(options.lastKnownAccountId ?? null),
    drainPendingRequests: sandbox.stub().callsFake(async () => {
      sessionExpired.value = false;
    }),
    abortPendingRequests: sandbox.stub().callsFake(() => {
      sessionExpired.value = false;
    }),
    login: sandbox.stub().resolves(false),
  };

  const wrapper = mountComponent(SessionExpiredModal, router, {
    pinia: options.pinia,
    provide: {
      site_config: {
        settings: () => ({}),
      },
      authn,
    },
  });

  return { wrapper, router, authn, sessionExpired };
};

describe('SessionExpiredModal Rendering', () => {
  it('renders the Modal and embedded LoginForm', () => {
    const { wrapper } = mountedSessionExpiredModal();
    expect(wrapper.findComponent(Modal).exists()).toBe(true);
    expect(wrapper.findComponent(LoginForm).exists()).toBe(true);
  });

  it('passes authn.lastKnownEmail as initialEmail to LoginForm', () => {
    const { wrapper } = mountedSessionExpiredModal({ lastKnownEmail: 'user@example.com' });
    const loginForm = wrapper.findComponent(LoginForm);
    expect(loginForm.props('initialEmail')).toBe('user@example.com');
  });

  it('passes empty string as initialEmail when lastKnownEmail is null', () => {
    const { wrapper } = mountedSessionExpiredModal({ lastKnownEmail: null });
    const loginForm = wrapper.findComponent(LoginForm);
    expect(loginForm.props('initialEmail')).toBe('');
  });

  // Regression: pv-rh4z / PR #234 — the session-expired modal re-authenticates
  // the existing user in place. It must not surface register, apply-for-account,
  // or forgot-password affordances (those belong on the standalone /auth/login
  // page, not in the modal).
  it('does not render register, apply, or forgot-password affordances', () => {
    const { wrapper } = mountedSessionExpiredModal();
    const html = wrapper.html();

    // No links/buttons pointing at the auxiliary auth routes
    expect(wrapper.find('a[href*="/auth/register"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/apply"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/forgot"]').exists()).toBe(false);
    expect(wrapper.find('a[href*="/auth/reset"]').exists()).toBe(false);

    // No router-link navigation to those named routes either
    expect(wrapper.find('[to*="register"]').exists()).toBe(false);
    expect(wrapper.find('[to*="forgot"]').exists()).toBe(false);
    expect(wrapper.find('[to*="apply"]').exists()).toBe(false);

    // Rendered markup contains no copy hinting at those flows
    expect(html).not.toMatch(/register/i);
    expect(html).not.toMatch(/apply/i);
    expect(html).not.toMatch(/forgot/i);
  });
});

describe('SessionExpiredModal Behavior', () => {
  const sandbox = sinon.createSandbox();

  let pinia: Pinia;

  beforeEach(() => {
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  afterEach(() => {
    sandbox.restore();
    localStorage.clear();
  });

  it('drains pending requests and clears sessionExpired when LoginForm emits success', async () => {
    const { wrapper, authn, sessionExpired } = mountedSessionExpiredModal({ sandbox, pinia, lastKnownAccountId: 'account-a' });
    signInAs('account-a');

    const loginForm = wrapper.findComponent(LoginForm);
    await loginForm.vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.drainPendingRequests.calledOnce).toBe(true);
    expect(authn.abortPendingRequests.called).toBe(false);
    // The modal is dismissed because sessionExpired is now false
    expect(sessionExpired.value).toBe(false);
  });

  describe('when the calendar store never loaded', () => {
    async function succeedAs(lastKnownAccountId: string | null, signedInAs: string) {
      const eventReset = sandbox.spy(useEventStore(), '$reset');
      const calendarStore = useCalendarStore();
      const mounted = mountedSessionExpiredModal({ sandbox, pinia, lastKnownAccountId });
      const replaceSpy = sandbox.spy(mounted.router, 'replace');
      signInAs(signedInAs);
      await mounted.wrapper.findComponent(LoginForm).vm.$emit('success');
      await mounted.wrapper.vm.$nextTick();
      return { ...mounted, eventReset, replaceSpy, calendarStore };
    }

    it('replays queued requests when authn knows the same account signed back in', async () => {
      const { authn, replaceSpy, eventReset } = await succeedAs('account-a', 'account-a');

      expect(authn.drainPendingRequests.calledOnce).toBe(true);
      expect(authn.abortPendingRequests.called).toBe(false);
      expect(replaceSpy.called).toBe(false);
      expect(eventReset.called).toBe(false);
    });

    it('aborts and resets when a different account than authn knew signs in', async () => {
      const { authn, replaceSpy, eventReset } = await succeedAs('account-a', 'account-b');

      expect(authn.abortPendingRequests.calledOnce).toBe(true);
      expect(authn.drainPendingRequests.called).toBe(false);
      expect(eventReset.calledOnce).toBe(true);
      expect(replaceSpy.calledOnceWith('/')).toBe(true);
    });

    it('treats an unknown previous account as a switch', async () => {
      const { authn, replaceSpy, eventReset } = await succeedAs(null, 'account-a');

      expect(authn.abortPendingRequests.calledOnce).toBe(true);
      expect(authn.drainPendingRequests.called).toBe(false);
      expect(eventReset.calledOnce).toBe(true);
      expect(replaceSpy.calledOnceWith('/')).toBe(true);
    });
  });

  it('lets a calendar store loaded for another account veto a replay', async () => {
    loadCalendarsFor('account-a');
    const eventReset = sandbox.spy(useEventStore(), '$reset');
    const { wrapper, router, authn } = mountedSessionExpiredModal({ sandbox, pinia, lastKnownAccountId: 'account-b' });
    const replaceSpy = sandbox.spy(router, 'replace');
    signInAs('account-b');

    await wrapper.findComponent(LoginForm).vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.abortPendingRequests.calledOnce).toBe(true);
    expect(authn.drainPendingRequests.called).toBe(false);
    expect(eventReset.calledOnce).toBe(true);
    expect(replaceSpy.calledOnceWith('/')).toBe(true);
  });

  it('aborts pending requests, clears sessionExpired, and routes to /auth/login on Modal close', async () => {
    const { wrapper, router, authn, sessionExpired } = mountedSessionExpiredModal({ sandbox, pinia });

    const pushSpy = sandbox.spy(router, 'push');

    const modal = wrapper.findComponent(Modal);
    await modal.vm.$emit('close');
    await wrapper.vm.$nextTick();

    expect(authn.abortPendingRequests.calledOnce).toBe(true);
    expect(authn.drainPendingRequests.called).toBe(false);
    // The modal is dismissed because sessionExpired is now false
    expect(sessionExpired.value).toBe(false);
    expect(pushSpy.calledOnce).toBe(true);
    expect(pushSpy.firstCall.args[0]).toEqual('/auth/login');
  });

  it('keeps the account\'s state and replays its requests when the same account signs back in', async () => {
    const calendarStore = loadCalendarsFor('account-a');
    const { wrapper, router, authn } = mountedSessionExpiredModal({ sandbox, pinia });
    const replaceSpy = sandbox.spy(router, 'replace');
    signInAs('account-a');

    await wrapper.findComponent(LoginForm).vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.drainPendingRequests.calledOnce).toBe(true);
    expect(authn.abortPendingRequests.called).toBe(false);
    expect(replaceSpy.called).toBe(false);
    expect(calendarStore.accountId).toBe('account-a');
    expect(calendarStore.selectedCalendarId).toBe('account-a-cal');
  });

  it('replays the same account\'s requests after a calendar load ran on the expired token', async () => {
    // Opening the calendar switcher (or any other ensureCalendarsLoaded
    // caller) after the token expired must not erase the "before" account.
    signInAs('account-a');
    const calendarStore = loadCalendarsFor('account-a');
    const expiredExp = Math.floor(Date.now() / 1000) - 60;
    localStorage.setItem('jw_token', JSON.stringify({ exp: expiredExp, id: 'account-a', isAdmin: false, email: 'account-a@example.com' }));
    const listStub = sandbox.stub(ModelService, 'listModels');
    await new CalendarService().ensureCalendarsLoaded();
    sinon.assert.notCalled(listStub);

    const { wrapper, authn } = mountedSessionExpiredModal({ sandbox, pinia });
    signInAs('account-a');
    await wrapper.findComponent(LoginForm).vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.drainPendingRequests.calledOnce).toBe(true);
    expect(authn.abortPendingRequests.called).toBe(false);
    expect(calendarStore.accountId).toBe('account-a');
    expect(calendarStore.selectedCalendarId).toBe('account-a-cal');
  });

  it('resets user state, aborts the previous account\'s requests and goes home when a different account signs in', async () => {
    // Replaying account A's queued requests under account B's token would
    // attribute A's mutations to B, so they are aborted, never drained.
    const calendarStore = loadCalendarsFor('account-a');
    const eventReset = sandbox.spy(useEventStore(), '$reset');
    const { wrapper, router, authn } = mountedSessionExpiredModal({ sandbox, pinia });
    const replaceSpy = sandbox.spy(router, 'replace');
    signInAs('account-b');

    await wrapper.findComponent(LoginForm).vm.$emit('success');
    await wrapper.vm.$nextTick();

    expect(authn.abortPendingRequests.calledOnce).toBe(true);
    expect(authn.drainPendingRequests.called).toBe(false);
    expect(eventReset.calledOnce).toBe(true);
    expect(calendarStore.accountId).toBeNull();
    expect(calendarStore.calendarInfos).toEqual([]);
    expect(calendarStore.selectedCalendarId).toBeNull();
    expect(localStorage.getItem(CURRENT_CALENDAR_STORAGE_KEY)).toBeNull();
    expect(replaceSpy.calledOnceWith('/')).toBe(true);
  });
});
