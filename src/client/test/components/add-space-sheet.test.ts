import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import AddSpaceSheet from '@/client/components/common/add-space-sheet.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import {
  EventLocation,
  EventLocationSpace,
  EventLocationSpaceContent,
} from '@/common/model/location';
import { ValidationError } from '@/common/exceptions';
import enSystem from '@/client/locales/en/system.json';
import enCalendars from '@/client/locales/en/calendars.json';

// Mock LocationService — only updateLocation is exercised by this sheet.
const mockUpdateLocation = vi.fn();

vi.mock('@/client/service/location', () => ({
  default: vi.fn().mockImplementation(() => ({
    updateLocation: mockUpdateLocation,
  })),
}));

const SheetStub = {
  props: ['title'],
  template: `
    <dialog role="dialog" aria-modal="true">
      <h2>{{ title }}</h2>
      <slot/>
    </dialog>
  `,
  emits: ['close'],
  setup() {
    return { open: () => {}, close: () => {} };
  },
};

/**
 * Stub for the SpacesEditor child. Mirrors the real component's contract:
 *   - props: `spaces` (the working buffer), `hideRemove` (forwarded boolean)
 *   - emits: `update:spaces` (add/edit) and `remove-space` (delete request)
 *
 * The stub records the most recent `hideRemove` prop so tests can assert that
 * the sheet wires the prop through. Clicking `.stub-add-space` stages a new
 * EventLocationSpace carrying a fresh `clientId`, mirroring SpacesEditor's
 * create-mode behavior.
 */
const SpacesEditorStub = {
  name: 'SpacesEditor',
  props: ['spaces', 'hideRemove'],
  emits: ['update:spaces', 'remove-space'],
  methods: {
    addStagedSpace(this: { spaces: EventLocationSpace[]; $emit: (event: string, ...args: any[]) => void }) {
      const staged = new EventLocationSpace(undefined, undefined);
      staged.clientId = `client-${Math.random().toString(36).slice(2, 10)}`;
      staged.addContent(new EventLocationSpaceContent('en', 'Staged Room', ''));
      this.$emit('update:spaces', [...(this.spaces ?? []), staged]);
    },
  },
  template: `
    <div class="spaces-editor-stub" :data-hide-remove="hideRemove ? 'true' : 'false'">
      <button type="button" class="stub-add-space" @click="addStagedSpace">Add</button>
      <ul>
        <li v-for="s in spaces" :key="s.id || s.clientId">{{ s.content('en')?.name }}</li>
      </ul>
    </div>
  `,
};

function makePlace(id: string, name: string, spaces: EventLocationSpace[] = []): EventLocation {
  const place = new EventLocation(id, name);
  place.spaces = spaces;
  return place;
}

describe('AddSpaceSheet', () => {
  beforeEach(async () => {
    mockUpdateLocation.mockReset();
    await i18next.init({
      lng: 'en',
      resources: {
        en: {
          system: enSystem,
          calendars: enCalendars,
        },
      },
    });
  });

  function mountWithI18n(options: any = {}) {
    return mount(AddSpaceSheet, {
      ...options,
      global: {
        plugins: [[I18NextVue, { i18next }]],
        components: options.global?.components,
        stubs: {
          Sheet: SheetStub,
          SpacesEditor: SpacesEditorStub,
          ...(options.global?.stubs ?? {}),
        },
      },
    });
  }

  describe('rendering', () => {
    it('should render with the place name interpolated into the title', () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
      });

      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
      expect(wrapper.find('h2').text()).toBe('Add a space to Community Center');
    });

    it('should render SpacesEditor with hide-remove enabled', () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
      });

      const editor = wrapper.find('.spaces-editor-stub');
      expect(editor.exists()).toBe(true);
      expect(editor.attributes('data-hide-remove')).toBe('true');
    });

    it('should render Save and Cancel buttons', () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
        global: {
          components: { PillButton },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      expect(buttons.length).toBe(2);

      const saveButton = buttons.find(b => b.text() === 'Save');
      const cancelButton = buttons.find(b => b.text() === 'Cancel');

      expect(saveButton).toBeDefined();
      expect(saveButton?.props('variant')).toBe('primary');
      expect(cancelButton).toBeDefined();
      expect(cancelButton?.props('variant')).toBe('ghost');
    });
  });

  describe('buffer initialization', () => {
    it('mounts with an empty spaces buffer when the place has no spaces', () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Empty Place'),
          calendarId: 'calendar-123',
        },
      });

      // No <li> rendered for an empty buffer.
      expect(wrapper.findAll('.spaces-editor-stub li').length).toBe(0);
    });

    it('does not mutate the prop place when buffer changes', async () => {
      const place = makePlace('place-1', 'Empty Place');
      const wrapper = mountWithI18n({
        props: { place, calendarId: 'calendar-123' },
      });

      await wrapper.find('.stub-add-space').trigger('click');
      await flushPromises();

      // Buffer in the editor reflects the staged add.
      expect(wrapper.findAll('.spaces-editor-stub li').length).toBe(1);
      // Original prop unchanged.
      expect(place.spaces.length).toBe(0);
    });
  });

  describe('save path', () => {
    it('calls LocationService.updateLocation once with the merged spaces[]', async () => {
      const place = makePlace('place-1', 'Community Center');
      mockUpdateLocation.mockImplementation((_calendarId, location: EventLocation) => {
        // Echo back the saved place; copy spaces with `clientId` echo per
        // the atomic Place + Spaces wire contract.
        const saved = makePlace(location.id, location.name);
        saved.spaces = (location.spaces ?? []).map((s, i) => {
          const echoed = new EventLocationSpace(s.id || `server-${i}`, saved.id);
          if (s.clientId) echoed.clientId = s.clientId;
          return echoed;
        });
        return Promise.resolve(saved);
      });

      const wrapper = mountWithI18n({
        props: { place, calendarId: 'calendar-123' },
        global: { components: { PillButton } },
      });

      // Stage a new space via the SpacesEditor stub.
      await wrapper.find('.stub-add-space').trigger('click');

      const buttons = wrapper.findAllComponents(PillButton);
      const saveButton = buttons.find(b => b.text() === 'Save');
      await saveButton?.vm.$emit('click');
      await flushPromises();

      expect(mockUpdateLocation).toHaveBeenCalledTimes(1);
      const [calledCalendarId, calledLocation] = mockUpdateLocation.mock.calls[0];
      expect(calledCalendarId).toBe('calendar-123');
      expect(calledLocation).toBeInstanceOf(EventLocation);
      expect(calledLocation.id).toBe('place-1');
      expect(calledLocation.name).toBe('Community Center');
      expect(calledLocation.spaces).toHaveLength(1);
      expect(calledLocation.spaces[0].clientId).toBeTruthy();
    });

    it('emits saved with the response from the service', async () => {
      const place = makePlace('place-1', 'Community Center');
      const savedPlace = makePlace('place-1', 'Community Center', [
        new EventLocationSpace('space-new', 'place-1'),
      ]);
      mockUpdateLocation.mockResolvedValue(savedPlace);

      const wrapper = mountWithI18n({
        props: { place, calendarId: 'calendar-123' },
        global: { components: { PillButton } },
      });

      await wrapper.find('.stub-add-space').trigger('click');

      const buttons = wrapper.findAllComponents(PillButton);
      const saveButton = buttons.find(b => b.text() === 'Save');
      await saveButton?.vm.$emit('click');
      await flushPromises();

      const savedEmits = wrapper.emitted('saved');
      expect(savedEmits).toBeTruthy();
      expect(savedEmits?.length).toBe(1);
      expect(savedEmits?.[0][0]).toBe(savedPlace);
    });

    it('does not emit cancelled or close on a successful save', async () => {
      const place = makePlace('place-1', 'Community Center');
      mockUpdateLocation.mockResolvedValue(makePlace('place-1', 'Community Center'));

      const wrapper = mountWithI18n({
        props: { place, calendarId: 'calendar-123' },
        global: { components: { PillButton } },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const saveButton = buttons.find(b => b.text() === 'Save');
      await saveButton?.vm.$emit('click');
      await flushPromises();

      expect(wrapper.emitted('cancelled')).toBeFalsy();
      expect(wrapper.emitted('close')).toBeFalsy();
    });
  });

  describe('cancel path', () => {
    it('emits cancelled and close without calling the service', async () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
        global: { components: { PillButton } },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      await cancelButton?.vm.$emit('click');
      await flushPromises();

      expect(mockUpdateLocation).not.toHaveBeenCalled();
      expect(wrapper.emitted('cancelled')).toBeTruthy();
      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('does not emit saved on cancel', async () => {
      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
        global: { components: { PillButton } },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const cancelButton = buttons.find(b => b.text() === 'Cancel');
      await cancelButton?.vm.$emit('click');
      await flushPromises();

      expect(wrapper.emitted('saved')).toBeFalsy();
    });
  });

  describe('error handling', () => {
    it('surfaces ValidationError messages via the alert region', async () => {
      mockUpdateLocation.mockRejectedValue(
        new ValidationError(['Name too long'], { name: ['Name too long'] }),
      );

      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
        global: { components: { PillButton } },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const saveButton = buttons.find(b => b.text() === 'Save');
      await saveButton?.vm.$emit('click');
      await flushPromises();

      const alert = wrapper.find('[role="alert"]');
      expect(alert.exists()).toBe(true);
      expect(alert.text()).toContain('Name too long');

      // Saved should NOT be emitted on validation failure.
      expect(wrapper.emitted('saved')).toBeFalsy();
    });

    it('surfaces non-validation errors via the alert region', async () => {
      mockUpdateLocation.mockRejectedValue(new Error('Server error'));

      const wrapper = mountWithI18n({
        props: {
          place: makePlace('place-1', 'Community Center'),
          calendarId: 'calendar-123',
        },
        global: { components: { PillButton } },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const saveButton = buttons.find(b => b.text() === 'Save');
      await saveButton?.vm.$emit('click');
      await flushPromises();

      const alert = wrapper.find('[role="alert"]');
      expect(alert.exists()).toBe(true);
      expect(wrapper.emitted('saved')).toBeFalsy();
    });
  });
});
