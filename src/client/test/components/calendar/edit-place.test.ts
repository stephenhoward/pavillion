import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPromises } from '@vue/test-utils';
import { createMemoryHistory, createRouter, Router } from 'vue-router';
import { RouteRecordRaw } from 'vue-router';
import { createPinia, setActivePinia } from 'pinia';
import { mountComponent } from '@/client/test/lib/vue';
import EditPlaceView from '@/client/components/logged_in/calendar/edit-place.vue';
import {
  EventLocation,
  EventLocationContent,
  EventLocationSpace,
  EventLocationSpaceContent,
} from '@/common/model/location';
import { Calendar } from '@/common/model/calendar';
import { useToast, resetToastState } from '@/client/composables/useToast';

const createMockCalendar = (id: string, urlName: string) => {
  const calendar = new Calendar(id, urlName);
  calendar.addContent({
    language: 'en',
    name: `Test Calendar ${urlName}`,
    description: 'Test Description',
  });
  return calendar;
};

/**
 * Build a Space with optional eventCount. Per the atomic Place + Spaces
 * wire contract, eventCount is a real model field populated by the
 * server's GET response — not a runtime augmentation.
 */
const createMockSpace = (
  id: string,
  placeId: string,
  contents: Array<{ language: string; name: string; accessibilityInfo?: string }>,
  eventCount?: number,
) => {
  const space = new EventLocationSpace(id, placeId);
  for (const c of contents) {
    space.addContent(new EventLocationSpaceContent(c.language, c.name, c.accessibilityInfo ?? ''));
  }
  if (typeof eventCount === 'number') {
    space.eventCount = eventCount;
  }
  return space;
};

/**
 * Build a Place with optional inline spaces. The server eager-loads
 * spaces and returns them on the Place payload; the client reads them via
 * `place.spaces`, not via a separate store accessor.
 */
const createMockLocation = (id: string, name: string, spaces: EventLocationSpace[] = []) => {
  const location = new EventLocation(id, name, '123 Main St', 'Springfield', 'IL', '62701');
  const content = new EventLocationContent('en', 'Wheelchair accessible');
  location.addContent(content);
  location.spaces = spaces;
  return location;
};

// Mock CalendarService
const mockGetCalendarByUrlName = vi.fn();

vi.mock('@/client/service/calendar', () => ({
  default: vi.fn().mockImplementation(() => ({
    getCalendarByUrlName: mockGetCalendarByUrlName,
  })),
}));

// Mock LocationService — per-Space CRUD methods are no longer used.
// Atomic save: createLocation/updateLocation accept and return spaces inline.
const mockGetLocationById = vi.fn();
const mockCreateLocation = vi.fn();
const mockUpdateLocation = vi.fn();
const mockReassignEvents = vi.fn();

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    getLocationById: mockGetLocationById,
    createLocation: mockCreateLocation,
    updateLocation: mockUpdateLocation,
    reassignEvents: mockReassignEvents,
  })),
}));

const routes: RouteRecordRaw[] = [
  { path: '/calendar/:calendar', component: {}, name: 'calendar' },
  { path: '/calendar/:calendar/places/new', component: EditPlaceView, name: 'place_new' },
  { path: '/calendar/:calendar/places/:placeId', component: EditPlaceView, name: 'place_edit', props: (route: { params: Record<string, string> }) => ({ placeId: route.params.placeId }) },
];

let routerPushSpy: ReturnType<typeof vi.fn>;

/**
 * Module-level "next staged Space name" used by the EditSpaceStub when it
 * emits `save`. Tests can write to this variable BEFORE clicking the stub's
 * Save button to control what name the staged payload carries — used by the
 * (new) affordance and clientId-echo end-to-end tests.
 *
 * Default value ('Stub Space') keeps existing tests that don't care about the
 * name working unchanged. Reset in `beforeEach`.
 */
let nextStagedSpaceName = 'Stub Space';

/**
 * Stub for the EditSpace child. The real component is tested independently
 * (`edit-space.test.ts`); stubbing it isolates this test to the parent's
 * staging buffer + dialog behavior.
 *
 * The stub mirrors the real child's emit contract: it emits `save` with a
 * freshly-built `EventLocationSpace` carrying per-language content. When the
 * `space` prop is set (edit mode), the staged payload preserves the source
 * row's `id`, `placeId`, and `clientId` so the parent's edit-merge path is
 * exercised. The staged name is read from the module-level
 * `nextStagedSpaceName` so tests can target specific names.
 */
const EditSpaceStub = {
  name: 'EditSpace',
  props: ['space'],
  emits: ['save', 'cancel'],
  methods: {
    buildStaged(this: { space?: EventLocationSpace | null }): EventLocationSpace {
      const source = this.space ?? null;
      const staged = new EventLocationSpace(
        source?.id || undefined,
        source?.placeId || undefined,
      );
      if (source?.clientId) staged.clientId = source.clientId;
      const name = source ? source.content('en').name : nextStagedSpaceName;
      staged.addContent(new EventLocationSpaceContent('en', name, ''));
      return staged;
    },
  },
  template: `
    <div class="space-editor">
      <button type="button" class="btn-cancel" @click="$emit('cancel')">Cancel</button>
      <button type="button" class="btn-save" @click="$emit('save', buildStaged())">Save</button>
    </div>
  `,
};

/**
 * Stub for the ModalLayout used by the reassign dialog. The real component
 * uses native `<dialog>` + showModal() which is not supported in happy-dom;
 * the stub renders the slot content directly so we can interact with it.
 */
const ModalLayoutStub = {
  name: 'ModalLayout',
  props: ['title', 'modalClass', 'initiallyOpen', 'size'],
  emits: ['close'],
  template: '<div role="dialog" aria-modal="true" :class="[\'modal\', modalClass]"><h2>{{ title }}</h2><slot /></div>',
};

const createWrapper = async (
  routeName: string = 'place_new',
  params: Record<string, string> = {},
  options: { stubs?: Record<string, any> } = {},
) => {
  const router: Router = createRouter({
    history: createMemoryHistory(),
    routes: routes,
  });

  const defaultParams = { calendar: 'test-calendar', ...params };
  await router.push({ name: routeName, params: defaultParams });
  await router.isReady();

  routerPushSpy = vi.fn();
  router.push = routerPushSpy;

  const pinia = createPinia();
  setActivePinia(pinia);

  const wrapper = mountComponent(EditPlaceView, router, {
    props: routeName === 'place_edit' ? { placeId: params.placeId } : {},
    pinia,
    stubs: {
      EditSpace: EditSpaceStub,
      ModalLayout: ModalLayoutStub,
      ...(options.stubs ?? {}),
    },
  });

  await flushPromises();
  return wrapper;
};

describe('EditPlaceView', () => {
  beforeEach(() => {
    mockGetCalendarByUrlName.mockReset();
    mockGetLocationById.mockReset();
    mockCreateLocation.mockReset();
    mockUpdateLocation.mockReset();
    mockReassignEvents.mockReset();

    mockGetCalendarByUrlName.mockResolvedValue(
      createMockCalendar('calendar-123', 'test-calendar'),
    );
    mockGetLocationById.mockResolvedValue(
      createMockLocation('loc-1', 'Community Center'),
    );
    mockCreateLocation.mockImplementation((_calendarId, location) => {
      // Echo back the saved place; copy spaces with `clientId` echo per
      // the atomic Place + Spaces wire contract.
      const saved = createMockLocation(location.id || 'loc-new', location.name);
      saved.spaces = (location.spaces ?? []).map((s: EventLocationSpace, i: number) => {
        const echoed = createMockSpace(s.id || `server-${i}`, saved.id, []);
        if (s.clientId) echoed.clientId = s.clientId;
        return echoed;
      });
      return Promise.resolve(saved);
    });
    mockUpdateLocation.mockImplementation((_calendarId, location) => {
      const saved = createMockLocation(location.id, location.name);
      saved.spaces = (location.spaces ?? []).map((s: EventLocationSpace, i: number) => {
        const echoed = createMockSpace(s.id || `server-${i}`, saved.id, []);
        if (s.clientId) echoed.clientId = s.clientId;
        return echoed;
      });
      return Promise.resolve(saved);
    });
    mockReassignEvents.mockResolvedValue({ count: 1 });

    // Auto-confirm window.confirm so dirty-state prompt does not block tests
    // that exercise the cancel path. Individual tests override as needed.
    // happy-dom does not define `confirm` by default, so we assign rather
    // than spy.
    window.confirm = vi.fn(() => true);

    // Reset the module-level staged-Space name and toast state so tests are
    // isolated from each other.
    nextStagedSpaceName = 'Stub Space';
    resetToastState();
  });

  describe('Create mode', () => {
    it('should render with "New Place" title', async () => {
      const wrapper = await createWrapper();
      const heading = wrapper.find('h1');
      expect(heading.exists()).toBe(true);
      expect(heading.text()).toBe('New Place');
    });

    it('should show empty form fields', async () => {
      const wrapper = await createWrapper();
      const nameInput = wrapper.find('#place-name');
      expect(nameInput.exists()).toBe(true);
      expect((nameInput.element as HTMLInputElement).value).toBe('');
    });

    it('should render all basic fields', async () => {
      const wrapper = await createWrapper();
      expect(wrapper.find('#place-name').exists()).toBe(true);
      expect(wrapper.find('#place-address').exists()).toBe(true);
      expect(wrapper.find('#place-city').exists()).toBe(true);
      expect(wrapper.find('#place-state').exists()).toBe(true);
      expect(wrapper.find('#place-postal-code').exists()).toBe(true);
    });

    it('should display a visible required indicator on the name field label', async () => {
      const wrapper = await createWrapper();
      const nameLabel = wrapper.find('label[for="place-name"]');
      expect(nameLabel.exists()).toBe(true);
      const indicator = nameLabel.find('.required-indicator');
      expect(indicator.exists()).toBe(true);
      expect(indicator.text()).toBe('*');
      expect(indicator.attributes('aria-hidden')).toBe('true');
    });

    it('should render accessibility info textarea', async () => {
      const wrapper = await createWrapper();
      const textarea = wrapper.find('[id^="place-accessibility-"]');
      expect(textarea.exists()).toBe(true);
    });

    it('should call createLocation on save with valid data', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Location');
      await wrapper.find('#place-address').setValue('456 Elm St');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).toHaveBeenCalledWith(
        'calendar-123',
        expect.objectContaining({
          name: 'New Location',
          address: '456 Elm St',
        }),
      );
    });

    it('should show error when name is empty on save', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should navigate back on cancel click when not dirty', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('should navigate back on back button click when not dirty', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('.back-button').trigger('click');

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('should navigate back after successful save', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Location');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('should render the Spaces section in create mode (no isEditMode gate)', async () => {
      const wrapper = await createWrapper();
      expect(wrapper.find('.spaces-section').exists()).toBe(true);
    });
  });

  describe('Edit mode', () => {
    it('should render with "Edit Place" title', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const heading = wrapper.find('h1');
      expect(heading.text()).toBe('Edit Place');
    });

    it('should populate form with existing location data', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      expect((wrapper.find('#place-name').element as HTMLInputElement).value).toBe('Community Center');
      expect((wrapper.find('#place-address').element as HTMLInputElement).value).toBe('123 Main St');
      expect((wrapper.find('#place-city').element as HTMLInputElement).value).toBe('Springfield');
      expect((wrapper.find('#place-state').element as HTMLInputElement).value).toBe('IL');
      expect((wrapper.find('#place-postal-code').element as HTMLInputElement).value).toBe('62701');
    });

    it('should call getLocationById to load existing location', async () => {
      await createWrapper('place_edit', { placeId: 'loc-1' });

      expect(mockGetLocationById).toHaveBeenCalledWith('calendar-123', 'loc-1');
    });

    it('should call updateLocation on save', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('#place-name').setValue('Updated Center');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledWith(
        'calendar-123',
        expect.objectContaining({
          name: 'Updated Center',
        }),
      );
    });

    it('should populate accessibility info from existing content', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      const textarea = wrapper.find('[id^="place-accessibility-"]');
      expect(textarea.exists()).toBe(true);
      expect((textarea.element as HTMLTextAreaElement).value).toBe('Wheelchair accessible');
    });
  });

  describe('Validation', () => {
    it('should validate location hierarchy errors', async () => {
      const wrapper = await createWrapper();

      // Set name and city without address (violates hierarchy)
      await wrapper.find('#place-name').setValue('Test Place');
      await wrapper.find('#place-city').setValue('Springfield');

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).not.toHaveBeenCalled();
      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });
  });

  describe('Error handling', () => {
    it('should show error when calendar is not found', async () => {
      mockGetCalendarByUrlName.mockResolvedValueOnce(null);
      const wrapper = await createWrapper();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should show error when save fails', async () => {
      mockCreateLocation.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Place');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
    });

    it('should allow dismissing error', async () => {
      const wrapper = await createWrapper();

      // Trigger a validation error
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      // Error should be visible
      expect(wrapper.find('[role="alert"]').exists()).toBe(true);

      // Dismiss the error
      await wrapper.find('.error-dismiss').trigger('click');
      await flushPromises();

      // Error should be gone
      expect(wrapper.find('[role="alert"]').exists()).toBe(false);
    });

    it('should have tabindex="-1" on error container for programmatic focus', async () => {
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(error.attributes('tabindex')).toBe('-1');
    });

    it('should move focus to error container when save fails', async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      mockCreateLocation.mockRejectedValueOnce(new Error('Server error'));
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('New Place');
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
      const focusedElements = focusSpy.mock.instances.filter(
        (el) => el === error.element,
      );
      expect(focusedElements.length).toBeGreaterThan(0);
      focusSpy.mockRestore();
    });

    it('should move focus to error container on validation error', async () => {
      const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
      const wrapper = await createWrapper();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      const error = wrapper.find('[role="alert"]');
      expect(error.exists()).toBe(true);
      expect(focusSpy).toHaveBeenCalled();
      const focusedElements = focusSpy.mock.instances.filter(
        (el) => el === error.element,
      );
      expect(focusedElements.length).toBeGreaterThan(0);
      focusSpy.mockRestore();
    });
  });

  describe('Loading state', () => {
    it('should show loading state initially', async () => {
      // Use a delayed mock so loading state is visible
      mockGetCalendarByUrlName.mockImplementation(() => new Promise(() => {}));

      const router: Router = createRouter({
        history: createMemoryHistory(),
        routes: routes,
      });

      await router.push({ name: 'place_new', params: { calendar: 'test-calendar' } });
      await router.isReady();

      const wrapper = mountComponent(EditPlaceView, router, {});

      // Loading should be showing before promises resolve
      expect(wrapper.find('[role="status"]').exists()).toBe(true);
    });
  });

  describe('Spaces section (atomic Place + Spaces save model)', () => {
    it('renders the Spaces section in edit mode with section title', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const section = wrapper.find('.spaces-section');
      expect(section.exists()).toBe(true);
      expect(section.text()).toContain('Spaces');
    });

    it('renders inline spaces from the Place payload (no separate fetch)', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      const items = wrapper.findAll('.space-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('Pacific Room');
    });

    it('renders an Add Space button', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });
      const addBtn = wrapper.find('.spaces-section .add-space-button');
      expect(addBtn.exists()).toBe(true);
      expect(addBtn.text()).toContain('Add room or space');
    });

    it('mounts the inline editor when Add Space button is clicked', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      expect(wrapper.find('.space-editor').exists()).toBe(false);
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(true);
    });

    it('mounts the inline editor with the existing space when Edit is clicked', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .edit-space-button').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(true);
    });

    it('closes the inline editor when child emits cancel', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      expect(wrapper.find('.space-editor').exists()).toBe(true);

      await wrapper.find('.space-editor .btn-cancel').trigger('click');
      await flushPromises();

      expect(wrapper.find('.space-editor').exists()).toBe(false);
    });
  });

  describe('Delete-Space dialog branch', () => {
    it('shows the plain confirm dialog when eventCount === 0', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 0),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Plain ConfirmDeleteDialog renders with the basic delete-confirm
      // message and no reassign options.
      expect(wrapper.find('.delete-space-modal').exists()).toBe(true);
      expect(wrapper.find('.reassign-space-modal').exists()).toBe(false);
      expect(wrapper.text()).toContain('Pacific Room');
    });

    it('shows the reassign dialog when eventCount > 0', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
          createMockSpace('space-2', 'loc-1', [{ language: 'en', name: 'Atlantic Room' }], 0),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Reassign dialog rendered; plain dialog suppressed.
      expect(wrapper.find('.reassign-space-modal').exists()).toBe(true);
      expect(wrapper.find('.delete-space-modal').exists()).toBe(false);
      // Prompt copy includes the event count.
      expect(wrapper.text()).toContain('3 events use this room or space');
    });

    it('reassign dialog dropdown excludes the Space being deleted', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
          createMockSpace('space-2', 'loc-1', [{ language: 'en', name: 'Atlantic Room' }], 0),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      const select = wrapper.find('.reassign-space-modal select');
      expect(select.exists()).toBe(true);
      const options = select.findAll('option');
      const optionTexts = options.map(o => o.text());
      expect(optionTexts).toContain('Atlantic Room');
      // Pacific Room is the Space being removed; it should be excluded.
      expect(optionTexts).not.toContain('Pacific Room');
    });

    it('whole-venue selection drops the Space without staging a reassign', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
          createMockSpace('space-2', 'loc-1', [{ language: 'en', name: 'Atlantic Room' }], 0),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      // Open reassign dialog (whole-venue is the default selection)
      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Confirm with default (whole-venue).
      await wrapper.find('.reassign-space-modal .btn--danger, .reassign-space-modal button.pill-button, .reassign-space-modal [type="button"]:not(.btn-ghost)').trigger('click');
      await flushPromises();

      // Save and assert no reassign call was issued.
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalled();
      expect(mockReassignEvents).not.toHaveBeenCalled();
    });

    it('non-whole-venue selection stages a pending reassign that fires after save', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
          createMockSpace('space-2', 'loc-1', [{ language: 'en', name: 'Atlantic Room' }], 0),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      // Pick the "different space" branch by setting the dropdown's value.
      const select = wrapper.find('.reassign-space-modal select');
      await (select.element as HTMLSelectElement).dispatchEvent(new Event('change'));
      await select.setValue('space-2');
      await flushPromises();

      // Confirm (the danger PillButton triggers stageSpaceRemoval).
      const dangerBtn = wrapper.findAll('.reassign-space-modal button').find(b => b.text().includes('Remove room or space'));
      expect(dangerBtn).toBeTruthy();
      await dangerBtn!.trigger('click');
      await flushPromises();

      // Save the place; reassign loop should fire post-save.
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalled();
      expect(mockReassignEvents).toHaveBeenCalledWith('calendar-123', 'loc-1', 'space-1', 'space-2');
    });
  });

  describe('Save orchestration: post-save reassign loop', () => {
    // The clientId-target → serverId translation path is covered end-to-end
    // by integration coverage. Here we cover the orchestration shape
    // (sequential issue, partial-failure tolerance) using the existing-target
    // dropdown branch.

    it('on partial reassign failure, surfaces a one-time toast warning and clears pendingReassigns', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
          createMockSpace('space-2', 'loc-1', [{ language: 'en', name: 'Atlantic Room' }], 0),
        ]),
      );
      mockReassignEvents.mockRejectedValueOnce(new Error('Reassign failed'));

      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      await wrapper.find('.space-item .delete-space-button').trigger('click');
      await flushPromises();

      const select = wrapper.find('.reassign-space-modal select');
      await select.setValue('space-2');
      await flushPromises();

      const dangerBtn = wrapper.findAll('.reassign-space-modal button').find(b => b.text().includes('Remove room or space'));
      await dangerBtn!.trigger('click');
      await flushPromises();

      await wrapper.find('form').trigger('submit');
      await flushPromises();

      // Reassign was attempted; failure does NOT block navigation.
      expect(mockReassignEvents).toHaveBeenCalledTimes(1);
      // Navigation still occurred: place save succeeded, partial-failure is
      // a toast-only signal per Decision 4 (no retained partial state).
      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');

      // Toast assertion: partial reassign failure must surface a `warning`
      // toast carrying the
      // resolved `places.error_reassign_partial` translation. The message is
      // resolved (not a key) because i18next-vue rendered it, so we assert on
      // the resolved English copy ("reassignment(s) failed").
      const { toasts } = useToast();
      expect(toasts.value).toHaveLength(1);
      expect(toasts.value[0].type).toBe('warning');
      expect(toasts.value[0].message).toContain('reassignment(s) failed');
    });
  });

  describe('Staging buffer: handleSpaceSaved merge path', () => {
    // The EditSpaceStub emits `save` with a real EventLocationSpace payload
    // (per the emit contract); the parent's `handleSpaceSaved` decides
    // whether to append (create) or replace-in-place (edit). This block
    // exercises both paths through the parent's wiring rather than through
    // child-internal logic.

    it('appends a staged Space to the list when Add Space → stub Save is clicked', async () => {
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      // Pre-condition: no spaces on this Place.
      expect(wrapper.findAll('.space-item').length).toBe(0);

      // Open the inline editor and emit save with a payload named 'Pacific Room'.
      nextStagedSpaceName = 'Pacific Room';
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      // The new Space appears in the list with its name.
      const items = wrapper.findAll('.space-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('Pacific Room');
    });

    it('replaces an existing Space row in place when Edit → stub Save is clicked', async () => {
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-1', 'loc-1', [{ language: 'en', name: 'Pacific Room' }]),
        ]),
      );
      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      // Pre-condition: one existing Space.
      expect(wrapper.findAll('.space-item').length).toBe(1);

      // Open the editor for the existing Space; the stub passes the source
      // row through, so its `buildStaged()` will preserve id+placeId and use
      // the existing name "Pacific Room" — exercising the in-place replace.
      await wrapper.find('.space-item .edit-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      // Still one row, still named "Pacific Room" — the row was replaced
      // in-place, not appended.
      const items = wrapper.findAll('.space-item');
      expect(items.length).toBe(1);
      expect(items[0].text()).toContain('Pacific Room');
    });
  });

  describe('Staging buffer: (new) affordance for staged Spaces', () => {
    // Per the atomic save contract, a staged-but-unsaved Space is
    // identified by `!space.id` (it has only a `clientId`). The list-row
    // template renders `space.reassign_new_suffix` (resolved as "(new)") for
    // those rows. After atomic save, the server echoes the row back with a
    // server-assigned `id`, so the affordance disappears on the post-save
    // re-render of the working buffer.

    it('shows the (new) affordance on a staged Space row', async () => {
      const wrapper = await createWrapper();

      nextStagedSpaceName = 'Pacific Room';
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      const items = wrapper.findAll('.space-item');
      expect(items.length).toBe(1);
      // Affordance is present on the staged row — text is the resolved
      // `(new)` copy from places.space.reassign_new_suffix.
      const affordance = items[0].find('.space-info__new-affordance');
      expect(affordance.exists()).toBe(true);
      expect(affordance.text()).toBe('(new)');
    });

    it('removes the (new) affordance after a successful save (server-echoed Space carries id)', async () => {
      const wrapper = await createWrapper();

      // Stage a Space and stamp its name into the form so the parent save
      // does not bail on validation.
      await wrapper.find('#place-name').setValue('New Place');
      nextStagedSpaceName = 'Pacific Room';
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      // Sanity: affordance is present pre-save.
      expect(
        wrapper.find('.space-item .space-info__new-affordance').exists(),
      ).toBe(true);

      // Save the place. The mockCreateLocation echo returns spaces with
      // server-assigned ids (`server-0`), so the post-save re-render of the
      // working buffer drops the affordance. The router push is stubbed; the
      // component still re-seeds `place` from `saved` BEFORE pushing.
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockCreateLocation).toHaveBeenCalled();
      // Post-save state: the (new) affordance is gone because the row now has
      // a server id.
      expect(
        wrapper.find('.space-item .space-info__new-affordance').exists(),
      ).toBe(false);
    });
  });

  describe('clientId-target translation end-to-end (post-save reassign)', () => {
    // The most architecturally novel contract here: when the user
    // stages a brand-new Space AND picks it as the reassign target for an
    // existing Space they're deleting, the working buffer holds a clientId
    // (the staged row has no server id yet). At save time, the server's
    // atomic POST/PUT echoes back the same clientId on the newly-created row
    // alongside its server-assigned id. The post-save reassign loop must
    // translate the staged clientId target → the freshly-issued server id
    // BEFORE invoking `reassignEvents`.

    it('translates a clientId reassign target to the server-assigned id', async () => {
      // Seed: existing Place with one Space that has events on it.
      mockGetLocationById.mockResolvedValueOnce(
        createMockLocation('loc-1', 'Community Center', [
          createMockSpace('space-old', 'loc-1', [{ language: 'en', name: 'Pacific Room' }], 3),
        ]),
      );

      // Override the update mock so the staged Space is echoed back with a
      // KNOWN server id ('server-fresh'). The default mock uses `server-${i}`
      // which would still work, but pinning the id makes the assertion
      // explicit about the translation behavior.
      mockUpdateLocation.mockImplementationOnce((_calendarId, location) => {
        const saved = createMockLocation(location.id, location.name);
        saved.spaces = (location.spaces ?? []).map((s: EventLocationSpace) => {
          // Pre-existing rows keep their id; staged rows get 'server-fresh'.
          const echoed = createMockSpace(s.id || 'server-fresh', saved.id, [
            { language: 'en', name: s.content('en')?.name ?? '' },
          ]);
          if (s.clientId) echoed.clientId = s.clientId;
          return echoed;
        });
        return Promise.resolve(saved);
      });

      const wrapper = await createWrapper('place_edit', { placeId: 'loc-1' });

      // Stage a brand-new Space (clientId only, no server id).
      nextStagedSpaceName = 'Atlantic Room';
      await wrapper.find('.add-space-button').trigger('click');
      await flushPromises();
      await wrapper.find('.space-editor .btn-save').trigger('click');
      await flushPromises();

      // Confirm the new Space rendered with the (new) affordance.
      const stagedRow = wrapper
        .findAll('.space-item')
        .find(item => item.text().includes('Atlantic Room'));
      expect(stagedRow).toBeTruthy();
      expect(stagedRow!.find('.space-info__new-affordance').exists()).toBe(true);

      // Open the delete dialog for the existing Space (Pacific Room) — it has
      // 3 events, so the reassign branch fires.
      const deleteBtn = wrapper
        .findAll('.space-item')
        .find(item => item.text().includes('Pacific Room'))!
        .find('.delete-space-button');
      await deleteBtn.trigger('click');
      await flushPromises();

      // The dropdown should list "Atlantic Room (new)" as an option. Its
      // value is the staged Space's clientId — read it off the option element
      // so the test does not have to reach into internal state.
      const select = wrapper.find('.reassign-space-modal select');
      expect(select.exists()).toBe(true);
      const options = select.findAll('option');
      const stagedOpt = options.find(o => o.text().includes('Atlantic Room'));
      expect(stagedOpt).toBeTruthy();
      const stagedClientId = stagedOpt!.attributes('value');
      expect(stagedClientId).toBeTruthy();
      // Sanity: the staged target's row key is a clientId, not a server id.
      // It must NOT match 'server-fresh' (yet) — the server hasn't run.
      expect(stagedClientId).not.toBe('server-fresh');

      // Pick the staged Space and confirm.
      await select.setValue(stagedClientId);
      await flushPromises();
      const dangerBtn = wrapper.findAll('.reassign-space-modal button').find(b => b.text().includes('Remove room or space'));
      await dangerBtn!.trigger('click');
      await flushPromises();

      // Save. The post-save loop translates clientId → 'server-fresh' via the
      // server's clientId echo, then calls reassignEvents.
      await wrapper.find('form').trigger('submit');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalled();
      // The reassign call MUST receive the server-assigned 'server-fresh' id,
      // NOT the staged clientId. This is the load-bearing assertion for the
      // clientId-echo translation contract.
      expect(mockReassignEvents).toHaveBeenCalledTimes(1);
      expect(mockReassignEvents).toHaveBeenCalledWith(
        'calendar-123',
        'loc-1',
        'space-old',
        'server-fresh',
      );
      // Cross-check: the clientId is NOT what got passed to reassignEvents.
      expect(mockReassignEvents).not.toHaveBeenCalledWith(
        'calendar-123',
        'loc-1',
        'space-old',
        stagedClientId,
      );
    });
  });

  describe('Dirty-state Cancel/Back prompt', () => {
    it('does not prompt when nothing has changed', async () => {
      const confirmSpy = vi.fn(() => true);
      window.confirm = confirmSpy;
      const wrapper = await createWrapper();

      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      // Pristine state: no prompt; navigation proceeds.
      expect(confirmSpy).not.toHaveBeenCalled();
      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('prompts and discards when user confirms', async () => {
      const confirmSpy = vi.fn(() => true);
      window.confirm = confirmSpy;
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('Dirty');
      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(confirmSpy).toHaveBeenCalled();
      expect(routerPushSpy).toHaveBeenCalledWith('/calendar/test-calendar?tab=places');
    });

    it('prompts and stays when user rejects', async () => {
      const confirmSpy = vi.fn(() => false);
      window.confirm = confirmSpy;
      const wrapper = await createWrapper();

      await wrapper.find('#place-name').setValue('Dirty');
      await wrapper.find('.btn-cancel').trigger('click');
      await flushPromises();

      expect(confirmSpy).toHaveBeenCalled();
      expect(routerPushSpy).not.toHaveBeenCalled();
    });
  });
});
