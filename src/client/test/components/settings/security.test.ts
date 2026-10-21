import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router, RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import { mountComponent } from '@/client/test/lib/vue';
import SecuritySettings from '@/client/components/logged_in/settings/security.vue';
import EmailModal from '@/client/components/logged_in/settings/email_modal.vue';
import PasswordModal from '@/client/components/logged_in/settings/password_modal.vue';
import AccountService from '@/client/service/account';
import { Account } from '@/common/model/account';

const routes: RouteRecordRaw[] = [
  { path: '/settings/account/security', component: {}, name: 'security' },
];

/**
 * Build a minimal Account object for mocking getProfile()
 */
function buildProfile(email: string): Account {
  return new Account('user-1', 'testuser', email);
}

/**
 * Mount the security leaf with the modals stubbed so their open state is
 * observable without rendering the shared Modal.
 */
function mountSecurity() {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes,
  });

  return mountComponent(SecuritySettings, router, {
    provide: {
      authn: {
        isAdmin: () => false,
        userEmail: () => 'session@example.com',
      },
    },
    stubs: {
      EmailModal: true,
      PasswordModal: true,
    },
  });
}

/**
 * Find the button whose visible text matches the given label.
 */
function buttonByText(wrapper: ReturnType<typeof mountSecurity>, label: string) {
  const button = wrapper.findAll('button').find(b => b.text() === label);
  if (!button) {
    throw new Error(`No button labelled "${label}"`);
  }
  return button;
}

describe('Security settings leaf', () => {
  beforeEach(() => {
    vi.spyOn(AccountService.prototype, 'getProfile').mockResolvedValue(buildProfile('profile@example.com'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the session email before the profile loads', () => {
    vi.spyOn(AccountService.prototype, 'getProfile').mockReturnValue(new Promise(() => {}));
    const wrapper = mountSecurity();

    expect(wrapper.text()).toContain('session@example.com');
  });

  it('keeps the session email on screen when the profile fails to load', async () => {
    vi.spyOn(AccountService.prototype, 'getProfile').mockRejectedValue(new Error('network'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const wrapper = mountSecurity();
    await flushPromises();

    expect(wrapper.findAll('.security-settings__value')[0].text()).toBe('session@example.com');
  });

  it('renders the email row with the address from the profile', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    expect(wrapper.text()).toContain('Email Address');
    expect(wrapper.text()).toContain('profile@example.com');
  });

  it('renders the password row', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    const labels = wrapper.findAll('.security-settings__label').map(l => l.text());
    expect(labels).toEqual(['Email Address', 'Password']);
    expect(buttonByText(wrapper, 'Change Password').exists()).toBe(true);
  });

  it('opens the email modal from Change Email', async () => {
    const wrapper = mountSecurity();
    await flushPromises();
    expect(wrapper.findComponent(EmailModal).exists()).toBe(false);

    await buttonByText(wrapper, 'Change Email').trigger('click');

    expect(wrapper.findComponent(EmailModal).exists()).toBe(true);
  });

  it('shows the new address when the email modal closes with one', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    await buttonByText(wrapper, 'Change Email').trigger('click');
    wrapper.findComponent(EmailModal).vm.$emit('close', 'changed@example.com');
    await flushPromises();

    expect(wrapper.findComponent(EmailModal).exists()).toBe(false);
    expect(wrapper.text()).toContain('changed@example.com');
  });

  it('keeps the current address when the email modal closes without one', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    await buttonByText(wrapper, 'Change Email').trigger('click');
    wrapper.findComponent(EmailModal).vm.$emit('close');
    await flushPromises();

    expect(wrapper.findComponent(EmailModal).exists()).toBe(false);
    expect(wrapper.text()).toContain('profile@example.com');
  });

  it('opens and closes the password modal', async () => {
    const wrapper = mountSecurity();
    await flushPromises();
    expect(wrapper.findComponent(PasswordModal).exists()).toBe(false);

    await buttonByText(wrapper, 'Change Password').trigger('click');
    expect(wrapper.findComponent(PasswordModal).exists()).toBe(true);

    wrapper.findComponent(PasswordModal).vm.$emit('close');
    await flushPromises();
    expect(wrapper.findComponent(PasswordModal).exists()).toBe(false);
  });

  it('marks Change Email and Change Password as opening a dialog', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    expect(buttonByText(wrapper, 'Change Email').attributes('aria-haspopup')).toBe('dialog');
    expect(buttonByText(wrapper, 'Change Password').attributes('aria-haspopup')).toBe('dialog');
  });

  it('does not repeat the layout title as a heading', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    expect(wrapper.findAll('h1, h2').length).toBe(0);
  });

  it('carries no funding card, logout control or inline svg', async () => {
    const wrapper = mountSecurity();
    await flushPromises();

    expect(wrapper.find('.funding-card').exists()).toBe(false);
    expect(wrapper.find('.logout-button').exists()).toBe(false);
    expect(wrapper.find('.account-settings-card svg').exists()).toBe(false);
  });

  it('leaves the help button to the shared settings header', async () => {
    const router: Router = createRouter({ history: createMemoryHistory(), routes });
    await router.push('/settings/account/security');
    const wrapper = mountComponent(SecuritySettings, router, {
      provide: { authn: { isAdmin: () => false, userEmail: () => 'session@example.com' } },
      stubs: { EmailModal: true, PasswordModal: true },
    });
    await flushPromises();

    expect(wrapper.find('button[aria-label="Help with this page"]').exists()).toBe(false);
  });
});
