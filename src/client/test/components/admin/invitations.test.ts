import { expect, describe, it, beforeEach, afterEach, vi } from 'vitest';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { flushPromises } from '@vue/test-utils';

import { mountComponent } from '@/client/test/lib/vue';
import Invitations from '@/client/components/admin/accounts/invitations.vue';
import ModelService from '@/client/service/models';
import ListResult from '@/client/service/list-result';

const routes: RouteRecordRaw[] = [
  { path: '/test', component: {}, name: 'test' },
];

const mountInvitationsComponent = () => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const authnMock = {
    resend_invitation: vi.fn(),
    revoke_invitation: vi.fn(),
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
  let listModelsSpy: any;
  let currentWrapper: any = null;

  beforeEach(() => {
    listModelsSpy = vi.spyOn(ModelService, 'listModels');
  });

  afterEach(() => {
    if (currentWrapper) {
      currentWrapper.unmount();
      currentWrapper = null;
    }
    vi.restoreAllMocks();
  });

  describe('Component Initialization', () => {
    it('loads invitations from admin endpoint on mount', async () => {
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify the correct endpoint and dataKey option were used
      expect(listModelsSpy).toHaveBeenCalledWith('/api/v1/admin/invitations', { dataKey: 'invitations' });

      // Verify invitations were loaded into store
      expect(wrapper.vm.store.invitations).toHaveLength(2);
      expect(wrapper.vm.store.invitations[0].email).toBe('user1@example.com');
    });

    it('shows empty state when no invitations exist', async () => {
      listModelsSpy.mockResolvedValue(ListResult.fromArray([]));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify empty state is displayed (active invitations section shows empty message)
      expect(wrapper.text()).toContain('No active invitations');
    });

    it('handles error loading invitations', async () => {
      listModelsSpy.mockRejectedValue(new Error('Failed to load invitations'));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      // Verify invitations array is empty (error is logged to console)
      expect(wrapper.vm.store.invitations).toEqual([]);
    });
  });

  describe('Invitation Actions', () => {
    it('cancels invitation using revoke_invitation', async () => {
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;
      authnMock.revoke_invitation.mockResolvedValue({});

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.cancelInvitation(invitation);

      // Verify revoke was called
      expect(authnMock.revoke_invitation).toHaveBeenCalledWith('inv-1');
    });

    it('resends invitation and shows success message', async () => {
      const testInvitations = [
        {
          id: 'inv-1',
          email: 'user1@example.com',
          invitedBy: 'admin-id',
          calendarId: null,
          expirationTime: new Date(Date.now() - 86400000).toISOString(),
          code: 'code1',
        },
      ];

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;
      authnMock.resend_invitation.mockResolvedValue({});

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.resendInvitation(invitation);

      // Verify resend was called
      expect(authnMock.resend_invitation).toHaveBeenCalledWith('inv-1');

      // Verify success message is shown
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.state.successMessage).toBeTruthy();
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;
      authnMock.resend_invitation.mockRejectedValue(new Error('Failed to resend'));

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.resendInvitation(invitation);

      // Verify error message is shown
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.state.errorMessage).toBeTruthy();
    });
  });

  describe('Invitation Display', () => {
    it('correctly formats dates', async () => {
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const formattedDate = wrapper.vm.formatDate(futureDate.toISOString());
      expect(formattedDate).toBeTruthy();
      expect(formattedDate).not.toBe('');
    });

    it('identifies expired invitations correctly', async () => {
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();
      await wrapper.vm.$nextTick();

      const isExpired = wrapper.vm.isExpired({ expirationTime: pastDate.toISOString() });
      expect(isExpired).toBe(true);
    });
  });

  describe('Unified Endpoint Integration', () => {
    it('uses /api/v1/admin/invitations with dataKey for listing invitations', async () => {
      listModelsSpy.mockResolvedValue(ListResult.fromArray([]));

      const { wrapper } = mountInvitationsComponent();
      currentWrapper = wrapper;

      await flushPromises();

      // Verify the admin endpoint is used with the dataKey option
      expect(listModelsSpy).toHaveBeenCalledWith('/api/v1/admin/invitations', { dataKey: 'invitations' });
    });

    it('uses authn.revoke_invitation for deleting invitations', async () => {
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

      listModelsSpy.mockResolvedValue(ListResult.fromArray(testInvitations));

      const { wrapper, authnMock } = mountInvitationsComponent();
      currentWrapper = wrapper;
      authnMock.revoke_invitation.mockResolvedValue({});

      await flushPromises();
      await wrapper.vm.$nextTick();

      const invitation = wrapper.vm.store.invitations[0];
      await wrapper.vm.cancelInvitation(invitation);

      // Verify the revoke method is used
      expect(authnMock.revoke_invitation).toHaveBeenCalledWith('inv-1');
    });
  });
});
