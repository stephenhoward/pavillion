import { describe, it, expect, beforeAll } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import LocationPickerModal from '@/client/components/common/location-picker-modal.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import enEventEditor from '@/client/locales/en/event_editor.json';
import enCalendars from '@/client/locales/en/calendars.json';

/**
 * Sheet stub: renders a native <dialog> with the given title + slot so
 * tests can continue to assert against dialog/h2 semantics without
 * wiring the full i18next-vue plugin that Sheet needs for its close
 * button aria-label.
 */
const SheetStub = {
  props: ['title'],
  template: `
    <dialog role="dialog" aria-modal="true">
      <h2>{{ title }}</h2>
      <slot/>
    </dialog>
  `,
  emits: ['close'],
};

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: {
      en: {
        event_editor: enEventEditor,
        calendars: enCalendars,
      },
    },
  });
});

const SHEET_GLOBAL = {
  global: {
    plugins: [[I18NextVue, { i18next }] as const],
    stubs: { Sheet: SheetStub },
  },
};

/**
 * Helper: build an EventLocationSpace with localized name content.
 */
function makeSpace(id: string, placeId: string, name: string): EventLocationSpace {
  const space = new EventLocationSpace(id, placeId);
  space.addContent(new EventLocationSpaceContent('en', name, ''));
  return space;
}

/**
 * Helper: clone a Place with the supplied Spaces inlined onto `place.spaces`.
 * The Spaces live directly on the Place; the picker no longer accepts a
 * separate spacesByPlace map.
 */
function placeWithSpaces(place: EventLocation, spaces: EventLocationSpace[]): EventLocation {
  const cloned = EventLocation.fromObject(place.toObject());
  cloned.spaces = spaces;
  return cloned;
}

describe('LocationPickerModal', () => {
  const mockLocations = [
    new EventLocation('loc-1', 'First Venue', '123 Main St', 'Portland', 'OR', '97201'),
    new EventLocation('loc-2', 'Second Venue', '456 Oak Ave', 'Portland', 'OR', '97202'),
    new EventLocation('loc-3', 'Third Place', '789 Pine Blvd', 'Beaverton', 'OR', '97003'),
  ];

  describe('rendering', () => {
    it('should render modal with title', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      expect(wrapper.find('dialog').exists()).toBe(true);
      expect(wrapper.find('h2').text()).toBe('Select Location');
    });

    it('should render search input with icon', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchWrapper = wrapper.find('.search-input-wrapper');
      expect(searchWrapper.exists()).toBe(true);
      expect(searchWrapper.find('input').exists()).toBe(true);
      expect(searchWrapper.find('input').attributes('placeholder')).toBe('Search locations...');
    });

    it('should render all locations in the list (Space-less Places: one entry each)', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const locationItems = wrapper.findAll('.location-item');
      expect(locationItems).toHaveLength(3);
    });

    it('should display location names and addresses', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const firstItem = wrapper.findAll('.location-item')[0];
      expect(firstItem.find('.location-name').text()).toBe('First Venue');
      expect(firstItem.find('.location-address').text()).toContain('123 Main St');
      expect(firstItem.find('.location-address').text()).toContain('Portland');
    });

    it('should show checkmark for selected location', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: 'loc-2',
        selectedSpaceId: null,
      },
      });

      const items = wrapper.findAll('.location-item');
      expect(items[0].find('.checkmark').exists()).toBe(false);
      expect(items[1].find('.checkmark').exists()).toBe(true);
      expect(items[2].find('.checkmark').exists()).toBe(false);
    });

    it('renders entries as native <button type="button"> with no role/tabindex overrides', () => {
      // Accessibility regression guard: each picker entry must be a native
      // <button>, not a div-as-button. The global button:not([role="tab"]) reset
      // and the .location-item width/text-align delta reproduce the prior
      // visuals; native semantics ensure AT virtual-cursor activation,
      // forced-colors mode styling, and built-in Enter/Space activation.
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const items = wrapper.findAll('.location-item');
      expect(items.length).toBeGreaterThan(0);

      // Element + type
      expect(items[0].element.tagName).toBe('BUTTON');
      expect(items[0].attributes('type')).toBe('button');

      // Negative regression: no leftover ARIA/keyboard plumbing
      expect(items[0].attributes('role')).not.toBe('button');
      expect(items[0].attributes('tabindex')).toBeUndefined();
    });

    it('wraps entries in <ul role="list"> with one <li> per entry', () => {
      // Explicit role="list" is a deliberate Safari/VoiceOver workaround:
      // when CSS removes default markers (via _reset.scss), Safari strips
      // list semantics. role="list" restores them.
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const list = wrapper.find('ul.location-list');
      expect(list.exists()).toBe(true);
      expect(list.attributes('role')).toBe('list');
      expect(list.findAll('li')).toHaveLength(mockLocations.length);
    });

    it('exposes aria-pressed on selected and unselected entries', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: 'loc-2',
        selectedSpaceId: null,
      },
      });

      const items = wrapper.findAll('.location-item');
      expect(items[0].attributes('aria-pressed')).toBe('false');
      expect(items[1].attributes('aria-pressed')).toBe('true');
      expect(items[2].attributes('aria-pressed')).toBe('false');
    });

    it('activates via the native button without manual @keydown handlers (no onkeydown attribute, click fires once)', async () => {
      // Single keyboard-activation invariant. The prior div-as-button shim
      // had explicit @keydown.enter / @keydown.space.prevent handlers; those
      // are gone, and a native <button type="button"> converts Enter and
      // Space into click events at the browser level. We assert (a) no
      // leftover onkeydown attribute on the rendered element and (b) a click
      // — which is what Enter/Space dispatch on a real button — emits the
      // selection exactly once. Testing Enter and Space separately would
      // over-test JSDOM rather than component logic (per testing-advisor).
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const item = wrapper.findAll('.location-item')[0];
      expect(item.attributes('onkeydown')).toBeUndefined();

      await item.trigger('click');

      const events = wrapper.emitted('location-selected');
      expect(events).toBeTruthy();
      expect(events?.length).toBe(1);
      expect(events?.[0]).toEqual([{ placeId: 'loc-1', spaceId: null }]);
    });

    it('should render footer buttons', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
          selectedSpaceId: null,
        },
        global: {
          plugins: [[I18NextVue, { i18next }] as const],
          components: { PillButton },
          stubs: { Sheet: SheetStub },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      expect(buttons.length).toBeGreaterThanOrEqual(2);

      const removeButton = buttons.find(b => b.text() === 'Remove location');
      const createButton = buttons.find(b => b.text() === 'Create New');

      expect(removeButton).toBeDefined();
      expect(createButton).toBeDefined();
    });
  });

  describe('flatten with Spaces', () => {
    const conventionCenter = new EventLocation('place-cc', 'Convention Center', '100 Main St', 'Portland', 'OR', '97201');

    it('Place with 0 Spaces renders 1 entry that selects (placeId, null)', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries).toHaveLength(1);
      expect(entries[0].find('.location-name').text()).toBe('Convention Center');

      await entries[0].trigger('click');
      expect(wrapper.emitted('location-selected')).toBeTruthy();
      expect(wrapper.emitted('location-selected')?.[0]).toEqual([
        { placeId: 'place-cc', spaceId: null },
      ]);
    });

    it('Place with 1 Space renders 2 entries (whole-venue + 1 Space)', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries).toHaveLength(2);

      // Entry 0: whole venue
      const entry0Text = entries[0].text();
      expect(entry0Text).toContain('Convention Center');
      expect(entry0Text).toContain('(whole venue)');

      // Entry 1: Space entry — primary line is just the Space name; the
      // parent Place name appears as a de-emphasized secondary line.
      const entry1 = entries[1];
      expect(entry1.find('.location-name').text()).toBe('Pacific Room');
      expect(entry1.find('.location-parent-name').text()).toBe('Convention Center');
    });

    it('Place with 2 Spaces renders 3 entries (whole-venue + 2 Spaces)', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [
          makeSpace('space-pacific', 'place-cc', 'Pacific Room'),
          makeSpace('space-council', 'place-cc', 'Council Chambers'),
        ])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries).toHaveLength(3);

      expect(entries[0].text()).toContain('(whole venue)');
      expect(entries[1].find('.location-name').text()).toBe('Pacific Room');
      expect(entries[2].find('.location-name').text()).toBe('Council Chambers');
    });

    it('whole-venue entry emits {placeId, spaceId: null} (NOT undefined)', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      await entries[0].trigger('click');

      const payload = wrapper.emitted('location-selected')?.[0]?.[0] as { placeId: string; spaceId: string | null };
      expect(payload).toEqual({ placeId: 'place-cc', spaceId: null });
      // Explicit null vs undefined: spaceId must be present and null, not absent.
      expect(Object.prototype.hasOwnProperty.call(payload, 'spaceId')).toBe(true);
      expect(payload.spaceId).toBeNull();
      expect(payload.spaceId).not.toBeUndefined();
    });

    it('Space entry emits {placeId, spaceId}', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      await entries[1].trigger('click');

      expect(wrapper.emitted('location-selected')?.[0]).toEqual([
        { placeId: 'place-cc', spaceId: 'space-pacific' },
      ]);
    });

    it('Space-less Place entry emits {placeId, spaceId: null}', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      await entries[0].trigger('click');

      expect(wrapper.emitted('location-selected')?.[0]).toEqual([
        { placeId: 'loc-1', spaceId: null },
      ]);
    });

    it('aria-label disambiguates whole-venue from Space entries', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries[0].attributes('aria-label')).toBe('Convention Center, whole venue');
      expect(entries[1].attributes('aria-label')).toBe('Convention Center, Pacific Room');
    });

    it('Space-less Place entry uses Place name as aria-label (no disambiguator)', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [conventionCenter],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entry = wrapper.findAll('.location-item')[0];
      // No comma-disambiguator on Space-less Places — Place name only.
      expect(entry.attributes('aria-label')).toBe('Convention Center');
    });

    it('shows checkmark for the selected (placeId, spaceId) combination — Space entry', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [
          makeSpace('space-pacific', 'place-cc', 'Pacific Room'),
          makeSpace('space-council', 'place-cc', 'Council Chambers'),
        ])],
        selectedLocationId: 'place-cc',
        selectedSpaceId: 'space-pacific',
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries[0].find('.checkmark').exists()).toBe(false); // whole venue
      expect(entries[1].find('.checkmark').exists()).toBe(true);  // Pacific Room
      expect(entries[2].find('.checkmark').exists()).toBe(false); // Council Chambers
    });

    it('shows checkmark on the whole-venue entry when selectedSpaceId is null', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: 'place-cc',
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries[0].find('.checkmark').exists()).toBe(true);  // whole venue
      expect(entries[1].find('.checkmark').exists()).toBe(false); // Pacific Room
    });

    it('marks Space entries with .is-space-entry class for visual indent', () => {
      // Visual hierarchy hook (stylesheet-advisor MED): Space entries get the
      // .is-space-entry class so SCSS can indent them under their parent Place.
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      expect(entries[0].classes()).not.toContain('is-space-entry'); // whole venue
      expect(entries[1].classes()).toContain('is-space-entry');     // Pacific Room
    });

    it('renders the (whole venue) suffix in a separate styled span for de-emphasis', () => {
      // Visual hierarchy hook (stylesheet-advisor MED): the "(whole venue)"
      // suffix is wrapped in .whole-venue-suffix so SCSS can render it in
      // var(--pav-text-secondary).
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const entries = wrapper.findAll('.location-item');
      const suffix = entries[0].find('.whole-venue-suffix');
      expect(suffix.exists()).toBe(true);
      expect(suffix.text()).toBe('(whole venue)');
    });

    it('a11y: whole-venue entry text content contains whitespace between place name and suffix', () => {
      // Regression guard: the place name and "(whole venue)" suffix
      // must be separated by whitespace in the DOM so AT flat-text concatenation
      // reads "Convention Center (whole venue)", not "Convention Center(whole venue)".
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [placeWithSpaces(conventionCenter, [makeSpace('space-pacific', 'place-cc', 'Pacific Room')])],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const locationName = wrapper.findAll('.location-item')[0].find('.location-name');
      // The normalized text ("Convention Center (whole venue)") must contain a
      // space between the place name and the suffix — not run them together.
      expect(locationName.text()).toMatch(/Convention Center\s+\(whole venue\)/);
    });
  });

  describe('search functionality', () => {
    it('should filter locations by name', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Second');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Second Venue');
    });

    it('should filter locations by address', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Pine');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Third Place');
    });

    it('should filter locations by city', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Beaverton');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Third Place');
    });

    it('should be case-insensitive', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('FIRST');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('First Venue');
    });

    it('should show no results when search has no matches', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('nonexistent');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(0);
    });

    it('search "pacific" matches the Space whose concatenated name contains "Pacific Room"', async () => {
      const conventionCenter = new EventLocation('place-cc', 'Convention Center', '100 Main St', 'Portland', 'OR', '97201');
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [
          placeWithSpaces(conventionCenter, [
            makeSpace('space-pacific', 'place-cc', 'Pacific Room'),
            makeSpace('space-council', 'place-cc', 'Council Chambers'),
          ]),
          ...mockLocations,
        ],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('pacific');

      const visibleItems = wrapper.findAll('.location-item');
      // Only the Pacific Room Space entry should match. Search target is the
      // concatenated "Convention Center — Pacific Room" string, but the row
      // renders the trimmed "Pacific Room" with "Convention Center" as the
      // de-emphasized parent line.
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Pacific Room');
      expect(visibleItems[0].find('.location-parent-name').text()).toBe('Convention Center');
    });

    it('Space row carries parent Place name as a de-emphasized secondary line so it stays self-describing when search filters out the parent', async () => {
      // Regression guard: searching for the Space name alone (which won't match
      // the parent) must still leave the Space row with visible parent context.
      const conventionCenter = new EventLocation('place-cc', 'Convention Center', '100 Main St', 'Portland', 'OR', '97201');
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [
          placeWithSpaces(conventionCenter, [
            makeSpace('space-pacific', 'place-cc', 'Pacific Room'),
          ]),
        ],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      await wrapper.find('.search-input-wrapper input').setValue('Pacific Room');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1); // parent whole-venue filtered out
      expect(visibleItems[0].find('.location-name').text()).toBe('Pacific Room');
      expect(visibleItems[0].find('.location-parent-name').text()).toBe('Convention Center');
    });
  });

  describe('selection behavior', () => {
    it('should emit location-selected with placeId/spaceId when a Place entry is clicked', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      await wrapper.findAll('.location-item')[1].trigger('click');

      expect(wrapper.emitted('location-selected')).toBeTruthy();
      expect(wrapper.emitted('location-selected')?.[0]).toEqual([
        { placeId: 'loc-2', spaceId: null },
      ]);
    });

    it('should allow clicking already selected location', async () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: mockLocations,
        selectedLocationId: 'loc-2',
        selectedSpaceId: null,
      },
      });

      await wrapper.findAll('.location-item')[1].trigger('click');

      expect(wrapper.emitted('location-selected')).toBeTruthy();
      expect(wrapper.emitted('location-selected')?.[0]).toEqual([
        { placeId: 'loc-2', spaceId: null },
      ]);
    });
  });

  describe('footer actions', () => {
    it('should emit create-new when Create New button clicked', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
          selectedSpaceId: null,
        },
        global: {
          plugins: [[I18NextVue, { i18next }] as const],
          components: { PillButton },
          stubs: { Sheet: SheetStub },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const createButton = buttons.find(b => b.text() === 'Create New');

      await createButton?.vm.$emit('click');

      expect(wrapper.emitted('create-new')).toBeTruthy();
    });

    it('should emit remove-location when Remove button clicked', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: 'loc-1',
          selectedSpaceId: null,
        },
        global: {
          plugins: [[I18NextVue, { i18next }] as const],
          components: { PillButton },
          stubs: { Sheet: SheetStub },
        },
      });

      const buttons = wrapper.findAllComponents(PillButton);
      const removeButton = buttons.find(b => b.text() === 'Remove location');

      await removeButton?.vm.$emit('click');

      expect(wrapper.emitted('remove-location')).toBeTruthy();
    });
  });

  describe('empty state', () => {
    it('should show message when no locations available', () => {
      const wrapper = mount(LocationPickerModal, { ...SHEET_GLOBAL, props: {
        locations: [],
        selectedLocationId: null,
        selectedSpaceId: null,
      },
      });

      const emptyMessage = wrapper.find('.empty-state');
      expect(emptyMessage.exists()).toBe(true);
      expect(emptyMessage.text()).toContain('No locations yet');
    });
  });
});
