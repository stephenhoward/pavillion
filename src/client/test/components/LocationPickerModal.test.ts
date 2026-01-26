import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LocationPickerModal from '@/client/components/common/LocationPickerModal.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import { EventLocation } from '@/common/model/location';

describe('LocationPickerModal', () => {
  const mockLocations = [
    new EventLocation('loc-1', 'First Venue', '123 Main St', 'Portland', 'OR', '97201'),
    new EventLocation('loc-2', 'Second Venue', '456 Oak Ave', 'Portland', 'OR', '97202'),
    new EventLocation('loc-3', 'Third Place', '789 Pine Blvd', 'Beaverton', 'OR', '97003'),
  ];

  describe('rendering', () => {
    it('should render modal with title', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      expect(wrapper.find('dialog').exists()).toBe(true);
      expect(wrapper.find('h2').text()).toBe('Select Location');
    });

    it('should render search input with icon', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchWrapper = wrapper.find('.search-input-wrapper');
      expect(searchWrapper.exists()).toBe(true);
      expect(searchWrapper.find('input').exists()).toBe(true);
      expect(searchWrapper.find('input').attributes('placeholder')).toBe('Search locations...');
    });

    it('should render all locations in the list', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const locationItems = wrapper.findAll('.location-item');
      expect(locationItems).toHaveLength(3);
    });

    it('should display location names and addresses', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const firstItem = wrapper.findAll('.location-item')[0];
      expect(firstItem.find('.location-name').text()).toBe('First Venue');
      expect(firstItem.find('.location-address').text()).toContain('123 Main St');
      expect(firstItem.find('.location-address').text()).toContain('Portland');
    });

    it('should show checkmark for selected location', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: 'loc-2',
        },
      });

      const items = wrapper.findAll('.location-item');
      expect(items[0].find('.checkmark').exists()).toBe(false);
      expect(items[1].find('.checkmark').exists()).toBe(true);
      expect(items[2].find('.checkmark').exists()).toBe(false);
    });

    it('should render footer buttons', () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
        global: {
          components: { PillButton },
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

  describe('search functionality', () => {
    it('should filter locations by name', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Second');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Second Venue');
    });

    it('should filter locations by address', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Pine');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Third Place');
    });

    it('should filter locations by city', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('Beaverton');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('Third Place');
    });

    it('should be case-insensitive', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('FIRST');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(1);
      expect(visibleItems[0].find('.location-name').text()).toBe('First Venue');
    });

    it('should show no results when search has no matches', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      const searchInput = wrapper.find('.search-input-wrapper input');
      await searchInput.setValue('nonexistent');

      const visibleItems = wrapper.findAll('.location-item');
      expect(visibleItems).toHaveLength(0);
    });
  });

  describe('selection behavior', () => {
    it('should emit location-selected when location clicked', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
      });

      await wrapper.findAll('.location-item')[1].trigger('click');

      expect(wrapper.emitted('location-selected')).toBeTruthy();
      expect(wrapper.emitted('location-selected')?.[0]).toEqual([mockLocations[1]]);
    });

    it('should allow clicking already selected location', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: 'loc-2',
        },
      });

      await wrapper.findAll('.location-item')[1].trigger('click');

      expect(wrapper.emitted('location-selected')).toBeTruthy();
      expect(wrapper.emitted('location-selected')?.[0]).toEqual([mockLocations[1]]);
    });
  });

  describe('footer actions', () => {
    it('should emit create-new when Create New button clicked', async () => {
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: mockLocations,
          selectedLocationId: null,
        },
        global: {
          components: { PillButton },
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
        },
        global: {
          components: { PillButton },
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
      const wrapper = mount(LocationPickerModal, {
        props: {
          locations: [],
          selectedLocationId: null,
        },
      });

      const emptyMessage = wrapper.find('.empty-state');
      expect(emptyMessage.exists()).toBe(true);
      expect(emptyMessage.text()).toContain('No locations yet');
    });
  });
});
