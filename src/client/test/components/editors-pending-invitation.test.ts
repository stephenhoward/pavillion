import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import Editors from '@/client/components/logged_in/calendar-management/editors.vue';
import CalendarService from '@/client/service/calendar';
import AuthenticationService from '@/client/service/authn';

// Mock i18next-vue so translation keys are returned as-is
vi.mock('i18next-vue', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const createWrapper = () => {
  const pinia = createPinia();
  setActivePinia(pinia);

  return mount(Editors, {
    props: {
      calendarId: 'test-calendar-id',
      isOwner: true,
    },
    global: {
      plugins: [pinia],
      stubs: {
        ModalLayout: {
          template: '<div class="modal-layout"><slot /></div>',
          props: ['title'],
          emits: ['close'],
        },
        PillButton: {
          template: '<button @click="$emit(\'click\')"><slot /></button>',
          emits: ['click'],
        },
        EmptyLayout: {
          template: '<div class="empty-layout"><slot /></div>',
          props: ['title', 'description'],
        },
        LoadingMessage: {
          template: '<div class="loading-message"></div>',
          props: ['description'],
        },
        Plus: { template: '<span />' },
        Mail: { template: '<span />' },
        Crown: { template: '<span />' },
        Globe: { template: '<span />' },
        ArrowUp: { template: '<span />' },
        Trash2: { template: '<span />' },
        X: { template: '<span />' },
      },
    },
  });
};

describe('Editors component — add editor pending invitation behaviour', () => {
  beforeEach(() => {
    // Stub userEmail to return null so canLeaveCalendar() is always false
    vi.spyOn(AuthenticationService.prototype, 'userEmail').mockReturnValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the pending invitation message when the submitted email is in pendingInvitations', async () => {
    const unregisteredEmail = 'notregistered@example.com';

    // Initial load: empty state
    const listStub = vi.spyOn(CalendarService.prototype, 'listCalendarEditors')
      .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [] })
      // After grantEditAccess the component calls loadEditors again — return pending
      .mockResolvedValueOnce({
        activeEditors: [],
        pendingInvitations: [{ id: 'inv-1', email: unregisteredEmail }],
      });

    const grantStub = vi.spyOn(CalendarService.prototype, 'grantEditAccess')
      .mockResolvedValue(undefined as any);

    const wrapper = createWrapper();
    // Wait for the initial onMounted loadEditors to settle
    await nextTick();
    await nextTick();

    // Simulate opening the add-editor form and typing the unregistered email
    wrapper.vm.state.showAddForm = true;
    wrapper.vm.state.newAccountId = unregisteredEmail;
    await nextTick();

    // Trigger addEditor
    await wrapper.vm.addEditor();
    await nextTick();

    expect(grantStub).toHaveBeenCalledWith('test-calendar-id', unregisteredEmail);
    expect(listStub).toHaveBeenCalledTimes(2);

    // The success message should be the "pending" key, not the "added" key
    expect(wrapper.vm.state.success).toBe('editor_invited_pending');
  });

  it('shows the normal success message when the submitted email appears as an active editor', async () => {
    const registeredEmail = 'registered@example.com';

    // Initial load: empty
    vi.spyOn(CalendarService.prototype, 'listCalendarEditors')
      .mockResolvedValueOnce({ activeEditors: [], pendingInvitations: [] })
      // After grant: the email is an active editor
      .mockResolvedValueOnce({
        activeEditors: [{ id: 'editor-1', email: registeredEmail }],
        pendingInvitations: [],
      });

    vi.spyOn(CalendarService.prototype, 'grantEditAccess')
      .mockResolvedValue(undefined as any);

    const wrapper = createWrapper();
    await nextTick();
    await nextTick();

    wrapper.vm.state.showAddForm = true;
    wrapper.vm.state.newAccountId = registeredEmail;
    await nextTick();

    await wrapper.vm.addEditor();
    await nextTick();

    // The success message should be the "added" key (t() returns the key as-is here)
    expect(wrapper.vm.state.success).toBe('editor_added_success');
  });
});
