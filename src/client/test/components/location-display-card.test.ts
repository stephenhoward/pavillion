import { describe, it, expect, beforeAll } from 'vitest';
import { mount } from '@vue/test-utils';
import i18next from 'i18next';
import I18NextVue from 'i18next-vue';
import LocationDisplayCard from '@/client/components/common/location-display-card.vue';
import PillButton from '@/client/components/common/pill-button.vue';
import { EventLocation, EventLocationSpace, EventLocationSpaceContent } from '@/common/model/location';
import enCalendars from '@/client/locales/en/calendars.json';

beforeAll(async () => {
  await i18next.init({
    lng: 'en',
    resources: {
      en: { calendars: enCalendars },
    },
  });
});

const I18N_GLOBAL = {
  plugins: [[I18NextVue, { i18next }] as const],
};

/**
 * Helper: build an EventLocationSpace with a localized name.
 */
function makeSpace(id: string, placeId: string, name: string): EventLocationSpace {
  const space = new EventLocationSpace(id, placeId);
  space.addContent(new EventLocationSpaceContent('en', name, ''));
  return space;
}

describe('LocationDisplayCard', () => {
  describe('with location (no space)', () => {
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
        global: I18N_GLOBAL,
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
        global: { ...I18N_GLOBAL, components: { PillButton } },
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
        global: { ...I18N_GLOBAL, components: { PillButton } },
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
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('Test Venue');
      expect(wrapper.find('.location-address').text()).toBe('123 Main St');
    });

    it('should show only Place name when space prop is null (whole venue)', () => {
      const location = new EventLocation('id', 'Laurelhurst Park', '123 SE César E Chávez Blvd');

      const wrapper = mount(LocationDisplayCard, {
        props: { location, space: null },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('Laurelhurst Park');
    });

    it('should show only Place name when space prop is omitted', () => {
      const location = new EventLocation('id', 'Laurelhurst Park', '123 SE César E Chávez Blvd');

      const wrapper = mount(LocationDisplayCard, {
        props: { location },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('Laurelhurst Park');
    });
  });

  describe('with location and space', () => {
    it('should render "Place — Space" when space prop is provided', () => {
      const location = new EventLocation('loc-1', 'Laurelhurst Park', '123 SE César E Chávez Blvd');
      const space = makeSpace('space-1', 'loc-1', 'Picnic Meadow');

      const wrapper = mount(LocationDisplayCard, {
        props: { location, space },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('Laurelhurst Park — Picnic Meadow');
    });

    it('should still show address alongside Place — Space label', () => {
      const location = new EventLocation('loc-1', 'Convention Center', '777 NE Martin Luther King Jr Blvd', 'Portland', 'OR', '97232');
      const space = makeSpace('space-1', 'loc-1', 'Pacific Room');

      const wrapper = mount(LocationDisplayCard, {
        props: { location, space },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('Convention Center — Pacific Room');
      expect(wrapper.find('.location-address').text()).toContain('777 NE Martin Luther King Jr Blvd');
    });

    it('should fall back to Place-only name when space has no content', () => {
      const location = new EventLocation('loc-1', 'My Venue', '1 Main St');
      const emptySpace = new EventLocationSpace('space-1', 'loc-1');
      // No content added to emptySpace

      const wrapper = mount(LocationDisplayCard, {
        props: { location, space: emptySpace },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').text()).toBe('My Venue');
    });
  });

  describe('without location', () => {
    it('should display Add Location button when location is null', () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: { ...I18N_GLOBAL, components: { PillButton } },
      });

      const button = wrapper.find('.location-display-card--empty');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Add Location');
      expect(button.find('svg').exists()).toBe(true); // Has icon
    });

    it('should emit add-location event when Add Location button clicked', async () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: { ...I18N_GLOBAL, components: { PillButton } },
      });

      await wrapper.find('.add-location-button').trigger('click');
      expect(wrapper.emitted('add-location')).toBeTruthy();
      expect(wrapper.emitted('add-location')).toHaveLength(1);
    });

    it('should have type="button" on Add Location button to prevent form submission', () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: I18N_GLOBAL,
      });

      const button = wrapper.find('.add-location-button');
      expect(button.attributes('type')).toBe('button');
    });

    it('should not display location info', () => {
      const wrapper = mount(LocationDisplayCard, {
        props: { location: null },
        global: I18N_GLOBAL,
      });

      expect(wrapper.find('.location-name').exists()).toBe(false);
      expect(wrapper.find('.location-address').exists()).toBe(false);
    });

    it('should display Add Location button when location is empty EventLocation', () => {
      // This is the case when creating a new event - location is initialized as new EventLocation()
      const emptyLocation = new EventLocation();

      const wrapper = mount(LocationDisplayCard, {
        props: { location: emptyLocation },
        global: { ...I18N_GLOBAL, components: { PillButton } },
      });

      const button = wrapper.find('.add-location-button');
      expect(button.exists()).toBe(true);
      expect(button.text()).toBe('Add Location');
      expect(button.find('svg').exists()).toBe(true); // Has icon
    });

    it('should emit add-location event when Add Location button clicked with empty location', async () => {
      const emptyLocation = new EventLocation();

      const wrapper = mount(LocationDisplayCard, {
        props: { location: emptyLocation },
        global: { ...I18N_GLOBAL, components: { PillButton } },
      });

      await wrapper.find('.add-location-button').trigger('click');
      expect(wrapper.emitted('add-location')).toBeTruthy();
      expect(wrapper.emitted('add-location')).toHaveLength(1);
    });
  });
});
