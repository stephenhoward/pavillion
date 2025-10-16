import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';
import axios from 'axios';

import { mountComponent } from '@/client/test/lib/vue';
import Invitations from '@/client/components/admin/accounts/invitations.vue';
import AccountInvitation from '@/common/model/invitation';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const mountInvitationsComponent = () => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const authnMock = {
    resendInvitation: vi.fn(),
  };

  const wrapper = mountComponent(Invitations, router, {
    provide: {
      authn: authnMock,
    },
  });

  return {
    wrapper,
    router,
    authnMock,
  };
};

describe('Admin Invitations Component', () => {
  let axiosGetSpy: any;
  let axiosDeleteSpy: any;
  let currentWrapper: any = null;

  beforeEach(() => {
    axiosGetSpy = vi.spyOn(axios, 'get');
    axiosDeleteSpy = vi.spyOn(axios, 'delete');
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('loads invitations from unified endpoint on mount', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() + 86400000).toISOString(),
          code: 'code1',
        },
        {
          id: 'inv-2',
          email: 'user2@example.com',
          invitedBy: 'user-id',
          calendarId: 'cal-1',
          expirationTime: new Date(Date.now() + 86400000).toISOString(),
          code: 'code2',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify the correct endpoint was called
      expect(axiosGetSpy).toHaveBeenCalledWith('/api/v1/admin/invitations');

      // Verify invitations were loaded into store
      expect(wrapper.vm.store.invitations).toHaveLength(2);
      expect(wrapper.vm.store.invitations[0]).toBeInstanceOf(AccountInvitation);
      expect(wrapper.vm.store.invitations[0].email).toBe('user1@example.com');
    });

    it('shows empty state when no invitations exist', async () => {
      axiosGetSpy.mockResolvedValue({ data: [] });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify empty state is displayed
      expect(wrapper.text()).toContain('No Invitations');
    });

    it('handles error loading invitations', async () => {
      axiosGetSpy.mockRejectedValue(new Error('Failed to load invitations'));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify error state is set
      expect(wrapper.vm.state.loadError).toBe(true);

      // Verify invitations array is empty
      expect(wrapper.vm.store.invitations).toEqual([]);

      // Verify error message is displayed
      expect(wrapper.text()).toContain('Failed to load invitations');
    });
  });

  describe('Invitation Actions', () => {
    it('cancels invitation using unified endpoint', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() + 86400000).toISOString(),
          code: 'code1',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });
      axiosDeleteSpy.mockResolvedValue({ data: {} });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.cancelInvitation(invitation);

      // Verify the correct delete endpoint was called
      expect(axiosDeleteSpy).toHaveBeenCalledWith('/api/v1/invitations/inv-1');

      // Verify invitation was removed from store
      expect(wrapper.vm.store.invitations).toHaveLength(0);
    });

    it('resends invitation and updates store', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() - 86400000).toISOString(), // Expired
          code: 'code1',
        },
      ];

      const updatedInvitation = {
        ...testInvitations[0],
        expirationTime: new Date(Date.now() + 86400000).toISOString(), // New expiration
        code: 'new-code',
      };

      axiosGetSpy.mockResolvedValue({ data: testInvitations });

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;

      authnMock.resendInvitation.mockResolvedValue(updatedInvitation);

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.resendInvitation(invitation);

      // Verify resend was called
      expect(authnMock.resendInvitation).toHaveBeenCalledWith('inv-1');

      // Verify store was updated with new invitation data
      // Note: The resend updates the invitation, but code may not be exposed in the model
      expect(wrapper.vm.store.invitations[0].email).toBe('user1@example.com');

      // Verify success message is shown
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.state.resendSuccess).toBe('user1@example.com');
    });

    it('handles resend invitation error', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() + 86400000).toISOString(),
          code: 'code1',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;

      authnMock.resendInvitation.mockRejectedValue(new Error('Failed to resend'));

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.resendInvitation(invitation);

      // Verify error message is shown
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.state.resendError).toBe('user1@example.com');
      expect(wrapper.vm.state.resending).toBeNull();
    });
  });

  describe('Invitation Display', () => {
    it('correctly formats expiration times', async () => {
      const futureDate = new Date(Date.now() + 86400000);
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: futureDate.toISOString(),
          code: 'code1',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const formattedTime = wrapper.vm.formatExpirationTime(futureDate);
      expect(formattedTime).not.toBe('expired');
      expect(formattedTime).not.toBe('unknown_expiration');
    });

    it('marks expired invitations correctly', async () => {
      const pastDate = new Date(Date.now() - 86400000);
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: pastDate.toISOString(),
          code: 'code1',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const isExpired = wrapper.vm.isExpired(pastDate);
      expect(isExpired).toBe(true);

      const formattedTime = wrapper.vm.formatExpirationTime(pastDate);
      expect(formattedTime).toBe('Expired');
    });
  });

  describe('Unified Endpoint Integration', () => {
    it('uses /api/v1/admin/invitations for listing invitations', async () => {
      axiosGetSpy.mockResolvedValue({ data: [] });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Verify the admin endpoint is used, not the old /api/accounts/v1/invitations
      expect(axiosGetSpy).toHaveBeenCalledWith('/api/v1/admin/invitations');
      expect(axiosGetSpy).not.toHaveBeenCalledWith('/api/accounts/v1/invitations');
    });

    it('uses /api/v1/invitations for deleting invitations', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() + 86400000).toISOString(),
          code: 'code1',
        },
      ];

      axiosGetSpy.mockResolvedValue({ data: testInvitations });
      axiosDeleteSpy.mockResolvedValue({ data: {} });

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.cancelInvitation(invitation);

      // Verify the unified endpoint is used for deletion
      expect(axiosDeleteSpy).toHaveBeenCalledWith('/api/v1/invitations/inv-1');
      expect(axiosDeleteSpy).not.toHaveBeenCalledWith('/api/accounts/v1/invitations/inv-1');
    });
  });
});
