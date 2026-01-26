import { describe, it, expect } from 'vitest';
import { mount } from '@vue/test-utils';
import LocationDisplayCard from '@/client/components/common/LocationDisplayCard.vue';
import PillButton from '@/client/components/common/PillButton.vue';
import { EventLocation } from '@/common/model/location';

describe('LocationDisplayCard', () => {
  describe('with location', () => {
    it('should render location name and address', () => {
      const location = new EventLocation(
        'https://pavillion.dev/places/loc-123',
        'Test Venue',
        '123 Main St',
        'Portland',
        'OR',
        '97201',
      );

      const wrapper = mount(LocationDisplayCard, {
        props: { location },
      });

      expect(wrapper.find('.location-name').text()).toBe('Test Venue');
      expect(wrapper.find('.location-address').text()).toContain('123 Main St');
      expect(wrapper.find('.location-address').text()).toContain('Portland');
      expect(wrapper.find('.location-address').text()).toContain('OR');
      expect(wrapper.find('.location-address').text()).toContain('97201');
    });

    it('should display Change button', () => {
      const location = new EventLocation('id', 'Venue', '123 Main St');

      const wrapper = mount(LocationDisplayCard, {
        props: { location },
        global: {
          components: { PillButton },
        },
      });

      const button = wrapper.findComponent(PillButton);
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Change');
      expect(button.props('variant')).toBe('ghost');
    });

    it('should emit change-location event when Change button clicked', async () => {
      const location = new EventLocation('id', 'Venue', '123 Main St');

      const wrapper = mount(LocationDisplayCard, {
        props: { location },
        global: {
          components: { PillButton },
        },
      });

      await wrapper.findComponent(PillButton).vm.$emit('click');
      expect(wrapper.emitted('change-location')).toBeTruthy();
      expect(wrapper.emitted('change-location')).toHaveLength(1);
    });

    it('should handle location with partial address', () => {
      const location = new EventLocation('id', 'Test Venue', '123 Main St');
      // city, state, postalCode are undefined

      const wrapper = mount(LocationDisplayCard, {
        props: { location },
      });

      expect(wrapper.find('.location-name').text()).toBe('Test Venue');
      expect(wrapper.find('.location-address').text()).toBe('123 Main St');
    });
  });

  describe('without location', () => {
    it('should display Add Location button when location is null', () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: {
          components: { PillButton },
        },
      });

      const button = wrapper.find('.location-display-card--empty');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Add Location');
      expect(button.find('svg').exists()).toBe(true); // Has icon
    });

    it('should emit add-location event when Add Location button clicked', async () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: {
          components: { PillButton },
        },
      });

      await wrapper.find('.location-display-card--empty').trigger('click');
      expect(wrapper.emitted('add-location')).toBeTruthy();
      expect(wrapper.emitted('add-location')).toHaveLength(1);
    });

    it('should not display location info', () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
      });

      expect(wrapper.find('.location-name').exists()).toBe(false);
      expect(wrapper.find('.location-address').exists()).toBe(false);
    });

    it('should display Add Location button when location is empty EventLocation', () => {
      // This is the case when creating a new event - location is initialized as new EventLocation()
      const emptyLocation = new EventLocation();

      const wrapper = mount(LocationDisplayCard, {
        props: { location: emptyLocation },
        global: {
          components: { PillButton },
        },
      });

      const button = wrapper.find('.location-display-card--empty');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Add Location');
      expect(button.find('svg').exists()).toBe(true); // Has icon
    });

    it('should emit add-location event when Add Location button clicked with empty location', async () => {
      const emptyLocation = new EventLocation();

      const wrapper = mount(LocationDisplayCard, {
        props: { location: emptyLocation },
        global: {
          components: { PillButton },
        },
      });

      await wrapper.find('.location-display-card--empty').trigger('click');
      expect(wrapper.emitted('add-location')).toBeTruthy();
      expect(wrapper.emitted('add-location')).toHaveLength(1);
    });
  });
});
